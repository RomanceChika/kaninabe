/**
 * 作成の**冪等な再送の枝**の SQL 断片(単発の作成 RPC と複合 RPC の先頭が共有する字面)と、
 * 定型の作成 RPC の事実に方針を載せる糊(`resendOf`)。
 *
 * 方針(`own` / `recorded` / `conflict`)は `usecase/resend-policy.ts` が表の宣言から引く。ここはそれを
 * plpgsql の字面にするだけで、判定を持たない。返す方針の枝は「持ち主の確かめ(`resendOwnership`)→ 入力の比べ
 * (`resendInputDiffers`。違えば拒否の語 `resend_input_mismatch`)→ 既存の行を返す」の順である(点検 20 回目 B20-1)。
 * 複合 RPC(保存点)の入力の全体の比べ(正規化した `p_input` の要約を短命の表に残し、再送で比べる)は、同じ仕組みの部品として
 * `rpc-resend-digest.ts` が持つ(点検 21 回目 A21-1。拒否の文 `raiseInputMismatch` はここを共有する)。`code-usecase-rpc.ts` は並べるだけ。
 *
 * **作成者の条件は実行者が null の呼び出しを「誰でも」と読まない。** `p_actor_id is not null` を
 * 必ず並べる —— 比較 `= null` は既に偽に畳まれるが、読み手が「null なら全部」と誤読しないよう、
 * また後の書き換えで `is not distinct from` に寄せられて null どうしが一致しないよう、字面に残す。
 * 実行者を持たない呼び出し(システムの処理)の再送は、作成者の欄が null の行でも返らず競合になる。
 *
 * **`recorded`(作成者の欄の無い表)は、未ログインとシステム(どちらも実行者 null)を同じ範囲に置く**(点検 21 回目 A の O21-1。分けない理由):
 * 監査ログの実行者の列は実行者の id だけを持ち、未ログインとシステムを見分ける欄が無い(見分けるには監査ログの形を変える = 新しい宣言の
 * 種類が要る)。同じ範囲でも害になるのは「未ログインで作れる表に、システムが**予測できる id** で作る経路」がある場合だけで、鍵は利用者の
 * 画面が作る UUID v4(122 bit)なので、未ログインの人がシステムの鍵を先に当てることはできない。今の製品で未ログインで作れる表は問い合わせ
 * だけで、システムが問い合わせを作る経路は無い。この前提(システムが作る id は推測できない)を崩す経路を足す日の宿題は BACKLOG に置いた
 * (未ログインで作れる表への、システムの作成の経路を検査で名指す)。
 *
 * **鍵(行の id)は利用者が選べる値である**(点検 21 回目 B の O21-2。受け入れる理由): 作成 RPC は形(UUID)だけを確かめ、別の表の既存の
 * id と同じ値でも作れる。表をまたいで同じ id があっても、監査ログを `entity_id` で引く本文は全部 `event_id`(作成の操作)も絞るので
 * 別の表の行と取り違えない(今の SQL の 9 か所。ここの `resendOwnership` も同じ)。`entity_id` だけで引く本文を書かないことが前提で、
 * それを検査で閉じるのは BACKLOG の宿題である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ResendPolicy } from '../usecase/resend-policy.js';
import { resendPolicyOf } from '../usecase/resend-policy.js';
import type { RpcFactsBase, RpcFactsInput } from './rpc-facts.js';
import type { RpcBodyProblem } from './rpc-params.js';
import { sqlLiteral } from './guard-to-sql.js';
import { AUDIT_TABLE } from './rpc-parts.js';
import { raiseResendTargetDeleted } from './rpc-resend-digest.js';

/** 実行者の引数(定型 RPC と複合 RPC で同じ名前)。 */
const ACTOR_PARAM = 'p_actor_id';

/**
 * その行を作ったのが今回の実行者である、の条件(`and` で並べる 2 項)。
 *
 * @param alias 行の別名(`t` など。列は必ず別名で修飾する —— 引数名や plpgsql の変数と取り違えない)
 * @param creator 作成者の欄
 * @returns SQL の条件式
 */
export function creatorCondition(alias: string, creator: string): string {
  return `${ACTOR_PARAM} is not null and ${alias}.${creator} = ${ACTOR_PARAM}`;
}

/**
 * 再送の枝の説明(SQL のコメント 1 行。方針ごとに 1 文)。
 *
 * @param policy 方針
 * @returns コメントの本文(`-- ` は付けない)
 */
export function resendNote(policy: ResendPolicy): string {
  switch (policy.kind) {
    case 'own':
      return `再送として返すのは、実行者が作った行(${policy.creator} = 実行者)だけ。他人の行は中身を返さず競合にする(実行者が null の呼び出しは誰の行とも一致しない)。`;
    case 'recorded':
      return '再送として返すのは、その作成の監査ログの実行者が今回の実行者と一致する行だけ(未ログインは null どうしで一致し、推測できない鍵が範囲になる)。他人の行は中身を返さず競合にする。';
    case 'conflict':
      return 'この表は再送で既存の行を返さない(resend.returns_existing: false)。同じ id の行があれば競合にする。';
  }
}

/**
 * 作成 RPC が、同じ txn の呼び手(保存点の複合 RPC)へ「この呼び出しは再送だった(既存の行を返した)」を知らせる設定の名前
 * (点検 22 回目 A22-1。値は返した行の id。txn の内だけ = `set_config(…, true)`)。
 *
 * 複合 RPC の先頭の再送の確かめは別の文なので、同じ鍵の 1 回目がまだコミットしていない間に届いた押し直しはそこを抜け、手順 1 の
 * 作成 RPC の再送の枝で 1 回目のコミットを待ってから既存の行を受け取る。**再送かどうかを決めるのは作成 RPC のこの枝の 1 か所**で、
 * 複合 RPC は印を読んで以降の手順を実行せずに先頭の枝と同じ比べと読み直しへ合流する(`usecase-rpc-resend.ts` の `resendAfterAnchor`)。
 * 作成 RPC の戻りの型(表の行)を変えずに知らせるための口で、単発で呼ばれたときは誰も読まない。
 */
export const RESEND_SIGNAL_SETTING = 'st.resent_id';

/**
 * 「再送だった」の印を立てる文(作成 RPC の再送の枝が、既存の行を返す直前に置く)。
 *
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function signalResend(indent: string): string {
  return `${indent}perform set_config(${sqlLiteral(RESEND_SIGNAL_SETTING)}, p_id::text, true);`;
}

/**
 * 印を消す文(複合 RPC が錨の作成 RPC を呼ぶ直前に置く。同じ txn の前の呼び出しの印を読まないため)。
 *
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function clearResendSignal(indent: string): string {
  return `${indent}perform set_config(${sqlLiteral(RESEND_SIGNAL_SETTING)}, '', true);`;
}

/**
 * 直前の作成 RPC が、その鍵の行を再送として返した、の条件。
 *
 * @param key 鍵の式(複合 RPC の `p_id`)
 * @returns SQL の条件式
 */
export function resendSignalled(key: string): string {
  return `current_setting(${sqlLiteral(RESEND_SIGNAL_SETTING)}, true) is not distinct from ${key}::text`;
}

/**
 * 作成が**新しい行を入れた後**に置く、1 回目の行が消された後の同じ鍵の押し直しを断る文(点検 23 回目 O23-2・A23-1)。
 *
 * 同じ鍵の行が無いので `on conflict (id) do nothing` は行を入れる。ところが同じ鍵の作成が監査ログ(追記専用で消えない)に既にあれば、
 * それは 1 回目が書けて、その後に行が消された(削除・外部キーの連鎖・消去)後の押し直しである。黙って作り直すと、消した人の判断が覆り、
 * 保存点では子の手順を実行しないまま「書けた」と返す(先頭の委任する枝が作成 RPC を呼び直す間に、錨を消す txn がコミットした形)。
 * そこで全体を戻して断る: 1 回目の実行者が今回の実行者なら `resend_target_deleted`(UC412。画面は「前回の送信で作ったものは削除されて
 * います」の種類の文言)、他人の鍵なら中身を言わず競合(呼び手の `conflict`)。判断は監査ログの 1 回目の作成だけで、要約の表は要らない。
 *
 * **行を入れた後に見る**のは、錨を消す txn との交錯でも答えが変わらないためである(入れる前に見ると、消す側のコミット前に「行がある」を
 * 読んでから、消す側のコミットの後に行を入れてしまう)。入れた後の文は新しいスナップショットで、1 回目の監査ログは必ずコミット済みである。
 *
 * @param input 断る文の材料
 * @param input.event 監査ログの `event_id` の式(作成の操作 ID の文字列の SQL か `p_event_id`)
 * @param input.operation 断るときの操作 ID の式
 * @param input.hasActor 実行者を受け取るか(受け取らない作成は実行者を比べず `resend_target_deleted`)
 * @param input.conflict 他人の鍵のときの競合の文(字下げ済み)
 * @param input.indent 字下げ
 * @returns plpgsql の行
 */
export function refuseRecreated(input: {
  readonly event: string;
  readonly operation: string;
  readonly hasActor: boolean;
  readonly conflict: string;
  readonly indent: string;
}): string[] {
  const { event, operation, hasActor, conflict, indent } = input;
  const earlier = `select 1 from public.${AUDIT_TABLE} r where r.entity_id = p_id and r.event_id = ${event}`;
  const deleted = raiseResendTargetDeleted(operation, `${indent}        `);
  return [
    `${indent}-- 同じ鍵の作成が監査ログに既にある = 1 回目の行が消された後の押し直し。作り直さずに断る(点検 23 回目 O23-2)。`,
    `${indent}if exists (${earlier}) then`,
    ...(hasActor
      ? [`${indent}    if exists (${earlier} and r.actor_id is not distinct from ${ACTOR_PARAM}) then`, deleted, `${indent}    end if;`, conflict]
      : [deleted.replace(/^ {4}/u, '')]),
    `${indent}end if;`,
  ];
}

/** 同じ鍵で入力が違う再送を断る拒否の語(閉じた語。画面の文言は製品の閉じた表が持つ)。 */
export const RESEND_INPUT_MISMATCH = 'resend_input_mismatch';

/**
 * 既存の行を返してよい、の条件(返す方針だけ。`conflict` は null)。
 *
 * @param policy 方針
 * @param alias 既存の行の別名
 * @param eventId その作成の操作 ID(監査ログの `event_id`)
 * @returns SQL の条件式(返さない方針は null)
 */
export function resendOwnership(policy: ResendPolicy, alias: string, eventId: string): string | null {
  switch (policy.kind) {
    case 'own':
      return creatorCondition(alias, policy.creator);
    case 'recorded':
      return (
        `exists (select 1 from public.${AUDIT_TABLE} r where r.entity_id = ${alias}.id and r.event_id = ${sqlLiteral(eventId)}` +
        ` and r.actor_id is not distinct from ${ACTOR_PARAM})`
      );
    case 'conflict':
      return null;
  }
}

/**
 * 再送で既存の行を返さない表(`resend.returns_existing: false`)に**同じ鍵**の押し直しが届いたときの拒否の語(閉じた語。UC409 の detail)。
 * 1 回目は書けているので、画面は「既に保存されている」の種類の文言にする(文言の表は実行時パッケージの `FRAMEWORK_REFUSAL_TEXT`)。
 * 別の鍵の本当の競合(前提の崩れ)はこの語を載せない。
 */
export const RESEND_ALREADY_SAVED = 'resend_already_saved';

/**
 * 既存の行を返さない表の、同じ鍵の押し直しを断る文(`UC409`・detail = 拒否の語)。単発の作成 RPC と複合 RPC の先頭の再送の枝が使う。
 *
 * @param operation 操作 ID の式(操作 ID の文字列の SQL か `p_event_id`)
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function raiseAlreadySaved(operation: string, indent: string): string {
  return `${indent}raise exception using errcode = 'UC409', message = 'usecase_conflict:' || ${operation}, detail = ${sqlLiteral(RESEND_ALREADY_SAVED)};`;
}

/**
 * 既存の行と今回の入力が違う、の条件(入力から入る列のどれかが違う。比べる列が無ければ null = 違いようがない)。
 *
 * @param alias 既存の行の別名
 * @param compared 入力から入る列と、作成が入れる式
 * @returns SQL の条件式
 */
export function resendInputDiffers(alias: string, compared: readonly { readonly name: string; readonly expression: string }[]): string | null {
  if (compared.length === 0) return null;
  return compared.map((column) => `${alias}.${column.name} is distinct from (${column.expression})`).join('\n                or ');
}

/**
 * 入力が違う再送を断る文(`UC412`・detail = 拒否の語)。
 *
 * @param operation 操作 ID の式(遷移は `p_event_id`、作成は操作 ID の文字列の SQL)
 * @param indent 字下げ
 * @returns plpgsql の 1 文
 */
export function raiseInputMismatch(operation: string, indent: string): string {
  return `${indent}raise exception using errcode = 'UC412', message = 'usecase_guard:' || ${operation}, detail = ${sqlLiteral(RESEND_INPUT_MISMATCH)};`;
}

/**
 * 作成が入れる列のうち、**同じ入力なら同じ値になる**列(再送の入力の比べ方)。
 *
 * 比べるのは入力(引数・`p_values`)から入る列だけである。id・実行者の列・時刻(`v_now` / `now()`)の式・トリガが供給する列
 * (後から値が変わる)は比べない。後の操作で書き換わった列は「違う」に数えられ、2 回目は拒否の語で断られる(1 回目は書けているので、
 * 画面は読み込み直して確かめるよう案内する)。
 *
 * @param columns 作成が入れる列(`insertColumns`)
 * @param supplied トリガが供給する列
 * @returns 比べる列
 */
export function resendComparedColumns(
  columns: readonly { readonly name: string; readonly expression: string; readonly fromParam: boolean; readonly actor: boolean }[],
  supplied: ReadonlySet<string>,
): readonly { readonly name: string; readonly expression: string }[] {
  return columns
    .filter((column) => column.name !== 'id' && !column.actor && !supplied.has(column.name))
    .filter((column) => (column.fromParam || column.expression.includes('p_values')) && !/\bv_now\b|\bnow\(\)|clock_timestamp\(\)/.test(column.expression))
    .map((column) => ({ name: column.name, expression: column.expression }));
}

/**
 * 作成の再送の方針を引く(作成以外は null)。
 *
 * 作成者の欄の候補は**本文が実行者そのもので埋める列**(`insertColumns` の `actor`)だけである。
 * 作成者で絞る枝は `p_actor_id` と比べるので、実行者を受け取らない作成 RPC には `own` を書けない。
 * 定型 RPC の事実を集める段(`rpc-facts.ts`)が呼ぶ。
 *
 * @param input 関数の宣言・表・ドメイン仕様
 * @param facts 述語より前に決まる事実(入れる列・実行者を受け取るか)
 * @returns 方針(作成以外は null)、または宣言の欠落・作成者の欄の誤り
 */
export function resendOf(
  input: RpcFactsInput,
  facts: RpcFactsBase,
):
  | { readonly ok: true; readonly policy: ResendPolicy | null; readonly compared: readonly { readonly name: string; readonly expression: string }[] }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] } {
  if (input.shape !== 'create') return { ok: true, policy: null, compared: [] };
  const actorColumns = facts.hasActor
    ? facts.insertColumns.filter((column) => column.actor).map((column) => column.name)
    : [];
  const policy = resendPolicyOf({ table: input.table, subject: input.name, actorColumns });
  if (!policy.ok) return { ok: false, problems: [policy.problem] };
  const supplied = new Set(input.table.triggers.flatMap((trigger) => trigger.supplies));
  return { ok: true, policy: policy.policy, compared: resendComparedColumns(facts.insertColumns, supplied) };
}
