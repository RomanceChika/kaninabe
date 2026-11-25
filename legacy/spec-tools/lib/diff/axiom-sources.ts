/**
 * 公理の側の差分(`axioms.ts`)が読む生成物の一覧。
 *
 * 6 軸の元(`sources.ts` の `diffSources`)とは数え方も見出しも別なので、別のファイルに置く(`sources.ts` が
 * 300 行を超えないため。責務は「どの生成物を比べるか」の宣言で、同じである)。純粋であり I/O を持たない。
 */

import { bookPath, generatedPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';
import type { DiffSource } from './sources.js';

/**
 * 公理の側の差分(`axioms.ts`)が読む生成物。6 軸の元(`diffSources`)ではなく、導出の側の行とは
 * 数え方も見出しも別である。表示名(`labelSources`)の生成物は、ここでは状態の意味の写しとして読む。
 */
export function axiomSources(roots: ProductRoots): readonly DiffSource[] {
  return [
    {
      axes: [],
      kind: 'file',
      path: generatedStatementsPath(roots),
      why: '不変条件の言明の写し。公理そのもの(人が意味を判定する文)であり、動いたかどうかが公理の側の差分になる',
    },
    {
      axes: [],
      kind: 'file',
      path: generatedSummariesPath(roots),
      why: '章頭の 1 文・節の要約・段の場面と、計算の例の表の行(入力 → 値)の写し。人が書き、人が仕様や外の世界と同じことを言っているかを読む文・例(公理)であり、書き換わったかどうかが公理の側の差分になる',
    },
  ];
}

/** 元のパス(要約の文の写し)。 */
export function generatedSummariesPath(roots: ProductRoots): string {
  return bookPath(roots, 'assets/summaries.json');
}

/** 元のパス(不変条件の言明の写し)。 */
export function generatedStatementsPath(roots: ProductRoots): string {
  return generatedPath(roots, 'invariants.ts');
}
