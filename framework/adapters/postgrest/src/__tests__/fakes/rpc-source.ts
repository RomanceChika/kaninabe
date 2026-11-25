/**
 * adapter のテストが共有する、DB への口の代わり(決めた応答を返し、呼び出しを記録する)。
 *
 * 置き換えるのは `RpcSource`(PostgREST の `rpc()` の形)という口だけで、モジュールの差し替えはしない。
 */

import type { CommitOutcome, CommitReceipt, RpcReturn } from '@kaninabe/runtime/ports';
import type { PostgrestErrorLike, RpcSource } from '../../rpc/rpc-outcome';
import { retryRollbacks } from '../../rpc/rollback-retry';

/** 制約名から不変条件 ID を引く(製品の生成物の代わり)。 */
export const invariantOf = (haystack: string): string | undefined =>
  haystack.includes('widgets_title_key') ? 'INV-WIDGET-001' : undefined;

/** PostgREST が返すエラーの形。 */
export function pgError(overrides: Partial<PostgrestErrorLike> = {}): PostgrestErrorLike {
  return { code: '', message: '', details: null, hint: null, ...overrides };
}

/** 呼び出しの記録つきの口(決めた応答を返す。`Error` を渡すと呼び出しが例外で終わる)。 */
export function sourceOf(response: { data: unknown; error: PostgrestErrorLike | null; status?: number } | Error): {
  readonly source: RpcSource;
  readonly calls: { name: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const source: RpcSource = retryRollbacks({
    rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ name, args });
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    },
  }, () => Promise.resolve());
  return { source, calls };
}

/** 書けた結果の受領だけを取り出す(書けていなければ失敗)。 */
export function receiptOfSaved(outcome: CommitOutcome<RpcReturn>): CommitReceipt<RpcReturn> {
  if (outcome.kind !== 'saved') throw new Error(`書けていない: ${outcome.kind}`);
  return outcome.receipt;
}
