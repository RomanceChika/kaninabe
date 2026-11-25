/**
 * テストが使う「製品の根」。
 *
 * **値を書き写さない**のが要点である。このリポジトリの `product.md` を実際に読んで使う ——
 * 書き写すと、根を動かした日にテストだけが古い綴りで緑になる(検査の意味が消える)。
 * 宣言そのものの読み方を試すテストは、この定数ではなく自分でフィクスチャを組む。
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProductRoots } from '../../lib/model/product/loader.js';
import { PRODUCT_DECL_FILE } from '../../lib/io/paths.js';
import type { ProductRoots, ProductTermScan } from '../../lib/model/product/types.js';
import type { ProductUses } from '../../lib/model/product/uses.js';

/** このリポジトリのルート(`legacy/spec-tools/__tests__/helpers` から 4 段上)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const declared = loadProductRoots(REPO_ROOT);
const loaded = declared.model.roots;
if (loaded === null || declared.uses === null) {
  throw new Error('product.md の根と採る種類(uses)を読めません。テストの前提(このリポジトリが製品である)が壊れています');
}

/** このリポジトリが宣言している根。 */
export const TEST_ROOTS: ProductRoots = loaded;

/** このリポジトリが宣言している、採る仕様の種類(`uses`)。 */
export const TEST_USES: ProductUses = declared.uses;

/** 追加の走査範囲を `term_scan:` の行に書き出す(全部空なら行なし)。 */
function termScanLines(termScan: ProductTermScan): readonly string[] {
  const fields: readonly (readonly [string, readonly string[]])[] = [
    ['prose_trees', termScan.proseTrees],
    ['prose_files', termScan.proseFiles],
    ['script_trees', termScan.scriptTrees],
    ['history', termScan.history],
  ];
  const written = fields.filter(([, values]) => values.length > 0);
  if (written.length === 0) return [];
  return ['term_scan:', ...written.flatMap(([key, values]) => [`  ${key}:`, ...values.map((value) => `    - ${value}`)])];
}

/**
 * 一時ツリーの直下に**このリポジトリと同じ根**を宣言した `product.md` を置く。
 *
 * 仕組みはリポジトリルートを「宣言を上へ探す」ことで決めるので(`detectRepoRoot`)、
 * 一時ツリーを製品として扱うテストは宣言を置く必要がある。**値は書き写さない** ——
 * `TEST_ROOTS` をそのまま書き出すので、根を動かした日にテストだけが古い綴りにならない。
 *
 * 採る仕様の種類(`uses`)は既定でこのリポジトリと同じだが、**一時ツリーが実際に持つ種類に合わせて渡す**
 * (仕様の木に置いたものと宣言が食い違うと P2 が落とす。置き場の無い木は `[]`)。
 *
 * @param root 一時ツリーのルート(絶対パス)
 * @param uses 一時ツリーが採る仕様の種類(省略するとこのリポジトリと同じ)
 */
export function writeProductDeclaration(root: string, uses: ProductUses = TEST_USES): void {
  const { name, summary, termScan, ...roots } = TEST_ROOTS;
  const lines = [
    '---',
    'doc_type: product_roots',
    'scope: common',
    'id: product-roots',
    '',
    // 製品の名前は**根ではない**ので `roots:` の外に書く(W1 / W2 の語彙に入るだけの宣言)。
    ...(name === null ? [] : [`name: ${name}`, '']),
    // 製品の一言(任意)も根ではない。書いてあれば引用符つきで書き写す(YAML として読み戻せる形)。
    ...(summary === undefined ? [] : [`summary: ${JSON.stringify(summary)}`, '']),
    'roots:',
    ...Object.entries(roots)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `  ${key}: ${String(value)}`),
    // 採る種類(空なら `uses: []`)。既定はこのリポジトリが宣言しているものを読んで書き出す(書き写さない)。
    ...(uses.length === 0 ? ['uses: []'] : ['uses:', ...uses.map((kind) => `  - ${kind}`)]),
    // 用語の台帳の追加の走査範囲。空の欄は書かない(宣言の無い製品と同じ形になる)。
    ...termScanLines(termScan),
    '---',
    '',
    '# テストが組む一時ツリーの根の宣言',
    '',
  ];
  writeFileSync(join(root, PRODUCT_DECL_FILE), lines.join('\n'));
}
