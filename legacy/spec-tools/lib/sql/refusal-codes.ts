/**
 * **拒否の分類**(RPC が行を返さなかったときの「なぜ」)の 1 表。
 *
 * RPC 単体で `by`(ロール)・ガード・期待状態を守るようになると(⑳-3)、0 行の理由が 3 つに
 * 分かれる —— 実行者のロールが足りない / ガードが成立しない / 判断時の前提が書き込みまでに
 * 崩れた。どれも行が 0 本という同じ見え方をするので、**errcode で区別する**。
 *
 * 語はここ 1 か所に置く。アプリ側の写像(`rpc.caller.ts`)と生成される plpgsql が別々に
 * 文字列リテラルを持つと、片方だけを直したときに「DB は 403 のつもり・アプリは競合と読む」が
 * 黙って作れる —— 制約名 → 不変条件 ID を 1 表にした `constraint-invariants.ts` と同じ理由である。
 *
 * docs 側で `UC409` の字面を持っていた生成器(`usecase-sql.ts` の複合 RPC・`code-inbound-rpc.ts`
 * の受信 RPC)は `raiseRefusal` を呼ぶ形に寄せた(束 ⑳-1b)。**app 側の写像
 * (`app/src/infrastructure/rpc/rpc.caller.ts`)はまだ字面を持っている** —— docs と app の境界を
 * 跨ぐ寄せ方は ⑳-3(拒否の 3 分類を app が読み分ける段)で決める。
 *
 * `forbidden` / `guard` を生成される本文へ組み込むのは ⑳-3。ここにあるのは定数と写像の表である。
 */

import { sqlStringLiteral } from '../kernel/safe-text.js';

/** 拒否の分類(値域)。 */
export const REFUSAL_KINDS = ['forbidden', 'guard', 'conflict'] as const;

/** 拒否の分類。 */
export type RefusalKind = (typeof REFUSAL_KINDS)[number];

/**
 * 分類 → SQLSTATE。
 *
 * `UC` は Postgres が予約していない 2 文字クラスで、既に複合 RPC の競合が `UC409` を使っている
 * (`usecase-sql.ts`)。数字は HTTP の同じ意味の符号に合わせてあり、**HTTP に写す規約ではない**
 * (読む人が分類を思い出しやすいだけの語呂である)。
 */
export const REFUSAL_CODES: Readonly<Record<RefusalKind, string>> = {
  forbidden: 'UC403',
  guard: 'UC412',
  conflict: 'UC409',
};

/**
 * 分類 → 例外の本文に載せる接頭辞。
 *
 * PostgREST は errcode を返すが、どの操作で落ちたかは本文にしか載らない。接頭辞を固定して
 * おくことで、アプリ側は「接頭辞の後ろが操作 ID」という 1 つの読み方で済む(既存の
 * `usecase_conflict:` と同じ形)。
 */
export const REFUSAL_MESSAGE_PREFIXES: Readonly<Record<RefusalKind, string>> = {
  forbidden: 'usecase_forbidden:',
  guard: 'usecase_guard:',
  conflict: 'usecase_conflict:',
};

/**
 * 分類 → エンジンの拒否理由(`FireRejectionReason` / `*RejectionReason` と同じ語彙)。
 *
 * TS の先読み(engine)と DB の拒否が**同じ語で話す**ための対応であり、**engine の理由 →
 * errcode の写像はこの表 1 つだけである**(束 ⑳-5a-b)。一致の証明が第 2 の表を持っていた
 * ころは `invalid_from → UC409` がここに無いまま app 側だけで発明されており、片方を直した
 * ときに黙ってずれる形が残っていた(独立レビュー 1-d)。app 側の写し
 * (`app/src/infrastructure/rpc/rpc.caller.ts` の `REFUSALS`)との一致は
 * `__tests__/guarantees/refusal-codes-parity.test.ts` が見る。
 *
 * 理由は**4 つの入口ぶん全部**を載せる —— 遷移(`canFire`)だけが `unknown_event` /
 * `invalid_from` を持ち、`canCreate` / `canWrite` / `canDelete` は残り 3 つを返す。
 *
 * | 分類 | engine の理由 | なぜその分類か |
 * |---|---|---|
 * | `forbidden` | `role_forbidden` | `by` のロールが立たない |
 * | `guard` | `guard_unsatisfied` / `guard_unknown` | ガードが成立しない(読めなかった事実は SQL 側も `coalesce(…, false)` で不成立に畳む) |
 * | `conflict` | `invalid_from` / `unknown_event` | **判断時の前提が崩れた** —— 本文は状態の段を最初に見て、宣言に無い遷移元・宣言に無いイベントはどちらもそこで落ちる(`rpc-body-refusal.ts` の `case` の `else false`) |
 */
export const REFUSAL_ENGINE_REASONS: Readonly<Record<RefusalKind, readonly string[]>> = {
  forbidden: ['role_forbidden'],
  guard: ['guard_unsatisfied', 'guard_unknown'],
  conflict: ['invalid_from', 'unknown_event'],
};

/**
 * 拒否を上げる plpgsql の 1 文。
 *
 * @param kind 拒否の分類
 * @param detail 本文の接頭辞に続けるもの(落ちた操作 ID など)
 * @param indent 行頭の字下げ
 * @returns `raise exception using errcode = …, message = …;` の 1 行
 */
export function raiseRefusal(kind: RefusalKind, detail: string, indent = ''): string {
  const message = sqlStringLiteral(`${REFUSAL_MESSAGE_PREFIXES[kind]}${detail}`);
  return `${indent}raise exception using errcode = '${REFUSAL_CODES[kind]}', message = ${message};`;
}

/**
 * 拒否を上げる plpgsql の 1 文(**本文の一部を実行時の式で決める**形)。
 *
 * 遷移の RPC は状態機械のすべてのイベントを受け持つので、落ちた操作 ID は引数
 * (`p_event_id`)にしか無い。接頭辞は固定のまま、その後ろだけを式で継ぐ(束 ⑳-3)。
 *
 * @param kind 拒否の分類
 * @param expression 接頭辞に続ける text 式(SQL の字面)
 * @param indent 行頭の字下げ
 * @returns `raise exception using errcode = …, message = … || <式>;` の 1 行
 */
export function raiseRefusalOf(kind: RefusalKind, expression: string, indent = ''): string {
  const prefix = sqlStringLiteral(REFUSAL_MESSAGE_PREFIXES[kind]);
  return (
    `${indent}raise exception using errcode = '${REFUSAL_CODES[kind]}', ` +
    `message = ${prefix} || ${expression};`
  );
}
