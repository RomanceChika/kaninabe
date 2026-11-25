/**
 * 操作の属性の連鎖を**確かめられなかった理由**(未検査)の文言。
 *
 * 根拠の行(`BASIS_NOTES.unverifiedCascade`)が「未検査: {ここ}(破壊的とみなす)」の中身に使う。理由の値域は
 * 意味の層(`semantics/operation-cascade.ts` の `UnverifiedCascade`)が持ち、ここは字面だけを組む(文言の層は葉)。
 */

import type { UnverifiedCascade } from '../semantics/operation-cascade.js';

/** この表が持つ固定の日本語の断片(`messages.ts` の FIXED_FRAGMENTS に合流する)。 */
export const CASCADE_FIXED_FRAGMENTS: readonly string[] = [
  '未検査: ',
  '(破壊的とみなす)',
  'ジョブカタログが読めないため、効果 ',
  ' が同じトランザクションで他の行を書くか確かめられない',
  '効果 ',
  ' がジョブカタログに無い',
  ' が実現する RPC を名指ししていない',
  'テーブル仕様が読めないため、RPC ',
  ' の書き込みを確かめられない',
  '名指しされた RPC ',
  ' がテーブル仕様に無い',
  ' の自表への書き込み(self_writes)が宣言されていない',
  ' が呼ぶ ',
];

/**
 * 未検査の理由の中身(何を確かめられなかったか)。
 *
 * @param reason 理由
 * @returns 文言
 */
export function unverifiedWhat(reason: UnverifiedCascade): string {
  switch (reason.kind) {
    case 'jobs_unavailable':
      return `ジョブカタログが読めないため、効果 ${reason.jobs.join(', ')} が同じトランザクションで他の行を書くか確かめられない`;
    case 'job_unknown':
      return `効果 ${reason.job} がジョブカタログに無い`;
    case 'rpc_unnamed':
      return `効果 ${reason.job} が実現する RPC を名指ししていない`;
    case 'data_tables_unavailable':
      return `テーブル仕様が読めないため、RPC ${reason.rpcs.join(', ')} の書き込みを確かめられない`;
    case 'rpc_missing':
      return `名指しされた RPC ${reason.rpc} がテーブル仕様に無い`;
    case 'self_writes_unknown':
      return `RPC ${reason.rpc} の自表への書き込み(self_writes)が宣言されていない`;
    case 'callee_missing':
      return `RPC ${reason.rpc} が呼ぶ ${reason.callee} がテーブル仕様に無い`;
  }
}
