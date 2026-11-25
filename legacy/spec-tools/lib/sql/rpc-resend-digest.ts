/**
 * 保存点(複合 RPC)の**再送の入力の全体の比べ**の SQL 断片(作成の再送の仕組み `rpc-resend.ts` の部品。点検 21 回目 A21-1)。
 *
 * 単発の作成の比べ・持ち主の確かめ・拒否の語 `resend_input_mismatch` は `rpc-resend.ts` が持ち、ここは保存点の入力の要約と、
 * それを置く短命の表(`framework-tables.ts` の設計図 `resend_digests`)の読み書きの字面だけを持つ。並べるのは
 * `generate/render/usecase-rpc-resend.ts`。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlLiteral } from './guard-to-sql.js';
import type { ResendDigestTable } from '../usecase/resend-policy.js';

/** 実行者の引数(複合 RPC の引数の名前)。 */
const ACTOR_PARAM = 'p_actor_id';

/**
 * 複合 RPC(保存点)の入力の要約を置く**仕組みの表**(`framework-tables.ts` の設計図 `resend_digests`。点検 21 回目 A21-1 の作り直し)。
 *
 * 単発の作成は入力から入る列を行と比べる(`resendInputDiffers`)。保存点はそれでは足りない —— 錨の作成の RPC に再送の確かめを
 * 任せると、比べの範囲が錨の 1 手順に縮み、子の手順(同行の参加者・資料・自分の参加者の欄)の入力を直した押し直しが「書けた」と返る。
 * 子の行は鍵を持たないので行ごとの対応も取れない。そこで**入力そのもの**の同一性を比べる: 1 回目に正規化した `p_input` の
 * 要約を 1 行残し、再送ではそれと今回の要約を比べる。
 *
 * **置き場は追記専用の監査ログではない。** 入力は個人列(表示名・連絡事項)を含み、塩の無い要約は推測した値の照合に使える。
 * 監査ログには消去が届かないので、消去の約束が弱まる。この表の行は短命である:
 *   - 保持の時間(data_table の `retention_hours`)を過ぎた行は比べに使わない。押し直しは `resend_expired` で断る(鍵は錨の行の
 *     id なので、新しい作成として受けると同じ id の行とぶつかる。黙って別の行を作ることもしない —— 画面は読み込み直して新しい鍵を持つ)
 *   - 過ぎた行は、次に保存点が 1 回目を書くときに消す(`recordResendDigest` の先頭。仕組みの外の定期の処理を要らなくする)
 *   - 実行者の消去でその人の行を消す(消去の RPC の宣言 `scrub_via` に `actor_id` で載り、T24 と erase-parity が見る)
 *
 * 置き場の表の引き当て(`resendDigestTableOf`)と、無いときの問題(`resendDigestStoreProblem`。Y12 と生成器が呼ぶ)は
 * `usecase/resend-policy.ts` が持つ(再送の方針と同じ置き場。検査の層から SQL の層を読まないため)。
 */
/** 保持の時間を過ぎた再送を断る拒否の語(UC412 の detail。画面は読み込み直しを案内する)。 */
export const RESEND_EXPIRED = 'resend_expired';

/**
 * 1 回目が作った錨の行が消された後に、同じ鍵の押し直しが届いたときの拒否の語(UC412 の detail)。
 * 1 回目の要約が保持の時間の内に残っているのに錨の行が無い = 1 回目は書けて、その後に消えた。「既に保存されています(一覧で確かめて)」は
 * 一覧に行が無いので誤りになる。画面は「前回の送信で作ったものは削除されています。作り直してください」の種類の文言を出す
 * (文言の表は実行時パッケージの `FRAMEWORK_REFUSAL_TEXT`)。新しい作成としては受けない(鍵の要約が残っていて、同じ鍵で作り直すと
 * 1 回目の要約と食い違う)。読み込み直すと新しい鍵になる。
 */
export const RESEND_TARGET_DELETED = 'resend_target_deleted';

/** 保持の時間の内である、の条件(`r.created_at` が今から保持の時間より後)。 */
function fresh(alias: string, hours: number): string {
  return `${alias}.created_at > now() - interval '${String(hours)} hours'`;
}

/**
 * 保存点の入力の要約の行の `event_id`(操作 ID と取り違えない接頭辞つき。操作 ID は `:` を含まない)。
 *
 * @param usecase ユースケースの名前
 * @param save 保存点の ID
 * @returns `event_id` の値
 */
export function resendDigestEvent(usecase: string, save: string): string {
  return `usecase:${usecase}.${save}`;
}

/** 入力の要約を作るときの手順 1 つ(`p_input` の鍵と、繰り返す手順か)。 */
export interface ResendInputSource {
  readonly alias: string;
  readonly repeat: boolean;
}

/**
 * 正規化した `p_input` の要約(SQL の式。`text` の 16 進の sha256)。
 *
 * 正規化の約束(同じ押し直しは同じ要約・中身が違えば違う要約):
 * - **鍵の順・空白**: jsonb は鍵の順と空白を持たない(テキストにしたときの並びは jsonb の正準の並び)。
 * - **見る鍵**: 手順の別名だけ(保存点が読まない鍵は行に入らないので外す)。手順の順に `jsonb_build_object` で並べ直す。
 * - **既定値**: 欄の無い入力と空(`null`)の入力は同じ行になる(取り出しは `->>` で、どちらも空 → 列の既定値)ので、
 *   `jsonb_strip_nulls` で空の欄を落として同じにする。繰り返さない手順が無い・オブジェクトでなければ `{}`、繰り返す手順が無い・配列で
 *   なければ `[]`(本文の `coalesce(…, '[]')` と同じ)。明示の値(`false`・`0`・空文字)は欄の無い入力と別に数える(既定値を本文の外で
 *   推測しない。同じ画面が同じ入力を組めば同じ値になる)。数の桁(`5` と `5.0`)も別に数える。
 * - **生成する id**: 子の行の id は本文が `gen_random_uuid()` で作り、入力に載らない。鍵 `p_id` は引き当ての側なので要約に入れない。
 * - **配列の順**: 繰り返す手順の要素の順は保つ(並べ替えた押し直しは違う入力として断る。同じ画面は同じ順で送る)。
 * - **入力の外**: `p_expected`(判断時の前提)と `p_actor_roles` は入力ではないので入れない。
 *
 * @param sources 保存点の手順(宣言順)
 * @param input 入力の引数(`p_input`)
 * @returns SQL の式
 */
export function resendInputDigest(sources: readonly ResendInputSource[], input: string): string {
  const seen = new Set<string>();
  const pairs: string[] = [];
  for (const source of sources) {
    if (seen.has(source.alias)) continue;
    seen.add(source.alias);
    const value = `${input} -> ${sqlLiteral(source.alias)}`;
    const kind = source.repeat ? 'array' : 'object';
    const empty = source.repeat ? "'[]'::jsonb" : "'{}'::jsonb";
    pairs.push(`${sqlLiteral(source.alias)}, case when jsonb_typeof(${value}) = '${kind}' then jsonb_strip_nulls(${value}) else ${empty} end`);
  }
  return `encode(sha256(convert_to(jsonb_build_object(${pairs.join(', ')})::text, 'UTF8')), 'hex')`;
}

/**
 * 1 回目の保存点の入力の要約を残す文(書いた錨の行に紐づく 1 行)。
 *
 * 先頭で、保持の時間を過ぎた行を消す(誰の行でも。掴めない行は飛ばす —— 並んだ 2 つの書き込みが同じ古い行を待ち合わない)。
 * 同じ鍵の行は、保持の時間を過ぎたものだけを消す(掴めずに残った古い行)。**保持の時間の内の同じ鍵の行は置き換えない** ——
 * 1 回目にコミットした入力が勝つ(点検 22 回目 A22-1)。足せなかったら(同じ鍵の 1 回目の要約が既にある = 1 回目は書けている)、
 * 書けたと返さずに `resend_target_deleted`(UC412)で断る。錨の作成 RPC の再送の印で合流する経路(`resendAfterAnchor`)では
 * ここへ来ないので、ここに当たるのは錨の行を消した後の同じ鍵の作り直しで、それは錨の作成 RPC が監査ログで先に断る(`rpc-resend.ts` の `refuseRecreated`。点検 23 回目 O23-2)ので、ここは三の線である(手書きの錨が印を落とす形は rpc-parity が `resendInput.signal` で止める)。
 * 以前は `resend_already_saved`(UC409「既に保存されています」)で断ったが、一覧に行が無いので誤りだった。
 *
 * @param input 残す行
 * @param input.store 置く表(`resendDigestTableOf`)
 * @param input.event `resendDigestEvent` の値
 * @param input.key 錨の行の id の式(複合 RPC の `p_id`)
 * @param input.digest `resendInputDigest` の式
 * @param input.indent 字下げ
 * @param input.operation 断るときの操作 ID の式(錨の操作 ID の文字列の SQL)
 * @returns plpgsql の文の並び
 */
export function recordResendDigest(input: {
  readonly store: ResendDigestTable;
  readonly event: string;
  readonly key: string;
  readonly digest: string;
  readonly indent: string;
  readonly operation: string;
}): string {
  const { store, event, key, digest, indent, operation } = input;
  const table = `public.${store.table}`;
  return [
    `${indent}with expired as (select o.id from ${table} o where not (${fresh('o', store.retentionHours)}) order by o.id for update skip locked)`,
    `${indent}delete from ${table} d using expired where d.id = expired.id;`,
    `${indent}delete from ${table} d where d.event_id = ${sqlLiteral(event)} and d.entity_id = ${key} and not (${fresh('d', store.retentionHours)});`,
    `${indent}insert into ${table} (event_id, entity_id, actor_id, input_digest)`,
    `${indent}values (${sqlLiteral(event)}, ${key}, ${ACTOR_PARAM}, ${digest})`,
    `${indent}on conflict (event_id, entity_id) do nothing;`,
    `${indent}if not found then`,
    raiseResendTargetDeleted(operation, `${indent}    `),
    `${indent}end if;`,
  ].join('\n');
}

/**
 * 再送の 1 回目の要約が保持の時間の内に無い、の条件(過ぎて比べに使えない・消去で消えた・この版より前に作った)。
 *
 * @param store 置く表
 * @param event `resendDigestEvent` の値
 * @param key 錨の行の id の式
 * @returns SQL の条件式
 */
export function resendDigestExpired(store: ResendDigestTable, event: string, key: string): string {
  return (
    `not exists (select 1 from public.${store.table} r where r.event_id = ${sqlLiteral(event)} and r.entity_id = ${key}` +
    ` and ${fresh('r', store.retentionHours)})`
  );
}

/**
 * 再送の入力が 1 回目と違う、の条件(保持の時間の内の 1 回目の要約と今回の要約が一致しない)。`resendDigestExpired` の後に置く。
 *
 * @param store 置く表
 * @param event `resendDigestEvent` の値
 * @param key 錨の行の id の式
 * @param digest 今回の入力の `resendInputDigest` の式
 * @returns SQL の条件式
 */
export function resendDigestDiffers(store: ResendDigestTable, event: string, key: string, digest: string): string {
  return (
    `not exists (select 1 from public.${store.table} r where r.event_id = ${sqlLiteral(event)} and r.entity_id = ${key}` +
    ` and ${fresh('r', store.retentionHours)} and r.input_digest = ${digest})`
  );
}

/**
 * 錨の行が消された後の同じ鍵の押し直しを断る文(`UC412`・detail = `resend_target_deleted`)。
 *
 * @param operation 操作 ID の式
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function raiseResendTargetDeleted(operation: string, indent: string): string {
  return `${indent}raise exception using errcode = 'UC412', message = 'usecase_guard:' || ${operation}, detail = ${sqlLiteral(RESEND_TARGET_DELETED)};`;
}

/**
 * 保持の時間を過ぎた再送を断る文(`UC412`・detail = `resend_expired`)。
 *
 * @param operation 操作 ID の式
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function raiseResendExpired(operation: string, indent: string): string {
  return `${indent}raise exception using errcode = 'UC412', message = 'usecase_guard:' || ${operation}, detail = ${sqlLiteral(RESEND_EXPIRED)};`;
}
