/**
 * 製品の根の宣言の検証(P 群)の配線。
 *
 * **全群の中で一番早く走る。** 他の群は走査ルートを受け取るが、走査ルートそのものがこの宣言
 * から出るためである(P0 = スキーマ適合 / P1 = 根の実在 / P2 = 採用の宣言と置き場の突合)。
 */

import type { Finding } from '../kernel/finding.js';
import { loadProductRoots } from '../model/product/loader.js';
import { PRODUCT_STEPS } from './checks.js';
import type { ProductRootsModel } from '../model/product/types.js';
import type { ProductUses } from '../model/product/uses.js';

/** runProduct の結果。 */
export interface ProductRunResult {
  /** P0 / P1 / P2 の Finding。 */
  readonly findings: readonly Finding[];
  /** 読み込んだ宣言(後続の群に配る)。 */
  readonly product: ProductRootsModel;
  /** 製品が採ると宣言した仕様の種類(宣言が読めなかったときは null。そのとき `product.roots` も null)。 */
  readonly uses: ProductUses | null;
}

/**
 * 宣言を読み、P 群を実行する。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @returns Finding と読み込んだ宣言
 */
export function runProduct(repoRoot: string): ProductRunResult {
  const loaded = loadProductRoots(repoRoot);
  return {
    findings: [
      ...loaded.findings,
      ...PRODUCT_STEPS.flatMap((step) => step.run({ repoRoot, product: loaded.model, uses: loaded.uses })),
    ],
    product: loaded.model,
    uses: loaded.uses,
  };
}
