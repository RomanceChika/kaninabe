/**
 * 仕組みの根の走査結果の型(`types-scan.ts` の製品の走査に、入れ子で添える)。
 *
 * **製品の走査の型は一切変えない。** `TestScanResult.available` は「製品の実装の木を走査できたか」だけを意味し、
 * 仕組みの見張りテストの走査は `framework` に分けて持つ —— 仕組みの根が在る・無いが製品の検査(15 件ほど)の
 * 「実装の木が無い」の判定に混ざらないようにするため。型を別の葉に置くのは、`types.ts` / `types-scan.ts` が
 * C24 の写し元の閉包に入っていて、触ると RPC のモデルの hash が動くからである(仕組みの走査は閉包の外の話)。
 */

import type { EachTagRef, HalfTagRef, TestAnnotation, TestBlockRef, TestScanResult } from './types-scan.js';

/**
 * 仕組みの根の走査の状態。
 *
 * - `scanned` … 走査した
 * - `not_requested` … 呼び手が根を渡さなかった(単体テスト用。CLI は必ず渡す。検査は**黙って緑にならず**、未実施と言う)
 * - `blocked` … 根が在るはずなのに走査できない(置き場が無い・読めないファイルがある)。検査は error で言う
 */
export type ScanScopeState =
  | { readonly state: 'scanned' }
  | { readonly state: 'not_requested'; readonly reason: string }
  | { readonly state: 'blocked'; readonly reason: string };

/**
 * 仕組みの根の見張りテストの走査結果。
 *
 * パスは**仕組みの根からの相対**(開発用の木と配布の木では製品のリポジトリルートと同じ)。`halfTags` などは
 * 製品の走査と同じく任意にしてある(他群のテストヘルパが空を明示しなくても壊れないように。読む側は `?? []`)。
 */
export interface FrameworkScan {
  readonly state: ScanScopeState;
  readonly testFiles: readonly string[];
  readonly annotations: readonly TestAnnotation[];
  readonly halfTags?: readonly HalfTagRef[];
  readonly eachTags?: readonly EachTagRef[];
  readonly testBlocks?: readonly TestBlockRef[];
  readonly assertionHelpers?: readonly string[];
}

/** 仕組みの走査を入れ子で持つ走査結果(`framework` が無い = 仕組みの根を渡していない)。 */
export type ScanWithFramework = TestScanResult & { readonly framework?: FrameworkScan };

/**
 * 仕組みの根を渡していない走査(`not_requested`)。
 *
 * @param reason 未実施の理由
 * @returns 空の走査結果
 */
export function notRequestedFrameworkScan(reason: string): FrameworkScan {
  return { state: { state: 'not_requested', reason }, testFiles: [], annotations: [] };
}
