/**
 * **送信の意図と、書けたかどうかの境界**(点検 20 回目 B20-1)。生成した Server Action が使う 2 つの純関数。
 *
 * | 関数 | 何をするか |
 * |---|---|
 * | `intentKeyOf` | 画面の実行器が第 2 引数で送る意図(`ActionIntent`)から冪等キーを取り出す。形(UUID)が違えば使わない(実行器がこの呼び出しで作る) |
 * | `temporaryFailureOf` | 実行器の例外が**コミットの状態が分かる DB の失敗**(`DbInfrastructureError`)なら、`temporarily_unavailable` の値にする(書けたかどうかを `commit` に載せる)。それ以外は `null`(呼び手は記録して投げ直す) |
 *
 * DB の失敗を例外の境界の手前で値にするのは、Server Action の例外が画面には digest しか届かないからである ——
 * 投げたままでは「巻き戻りが確実」と「書けたか分からない」を画面が区別できない。想定外の例外(DB の失敗でないもの)は
 * 値にしない: スタックを残すために投げ直し、画面の実行器が `unknown` として扱う。
 *
 * 置き場は domain 層である(生成した Server Action が引ける層。operation 層は Server Action から引けない)。そのため DB の失敗の
 * クラスを import せず、例外の契約の欄(`name` と `commit`。`operation/commit-outcome.ts` が宣言する)で見分ける。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ActionError } from './result';

/** DB の失敗の例外の名前(`operation/commit-outcome.ts` の `DbInfrastructureError` が宣言する名前)。 */
const DB_FAILURE_NAME = 'DbInfrastructureError';

/** 冪等キーの形(RFC 9562 の UUID。版と変種まで見る)。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 画面が送った意図から冪等キーを取り出す。
 *
 * @param intent - Server Action の第 2 引数(信用しない入力)
 * @returns 形の正しい冪等キー(無い・形が違えば `undefined`)
 */
export function intentKeyOf(intent: unknown): string | undefined {
  if (typeof intent !== 'object' || intent === null) return undefined;
  const key: unknown = (intent as { readonly idempotencyKey?: unknown }).idempotencyKey;
  return typeof key === 'string' && UUID.test(key) ? key.toLowerCase() : undefined;
}

/**
 * 実行器の例外を、書けたかどうかの分かる一時的な失敗の値にする。
 *
 * @param cause - 実行器が投げたもの
 * @returns DB の失敗なら `temporarily_unavailable`(`commit` つき)、それ以外は `null`
 */
export function temporaryFailureOf(cause: unknown): Extract<ActionError, { kind: 'temporarily_unavailable' }> | null {
  if (!(cause instanceof Error) || cause.name !== DB_FAILURE_NAME) return null;
  const commit: unknown = (cause as { readonly commit?: unknown }).commit;
  return commit === 'not_committed' || commit === 'unknown' ? { kind: 'temporarily_unavailable', commit } : null;
}
