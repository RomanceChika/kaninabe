/**
 * 通し実行(`samples:db`)の一時ツリーのうち、**置き場の配置が決める位置**(土台のディレクトリ・ソースの根・import の別名)。
 *
 * 一時ツリーは題材の宣言した実装の木(`roots.app`)の下に、アプリの枠の後段が与えた配置の木を組む。層の名前(`infrastructure` ほか)はコアの語、
 * 土台の置き場(`supabase` ・`__tests__`)とソースの根(`src`)と import の別名(`@`)はアプリの枠の綴りなので、ここは配置から引く
 * (以前は通し実行の道具が `src/infrastructure/…` を直書きしていた。部品化 ③-c6)。決められなければ止める —— 通し実行は設計に無い経路を作らず、
 * 既定値に倒さない(一時ツリーの外を指すため。`sampleAppRoot` と同じ扱い)。
 */

import { layoutBaseDirPath } from '../../../model/framework-base-dirs.js';
import { CORE_REQUIRED_BASE_DIRS } from '../../../model/framework-dirs.js';
import { layoutModule, sourceRootPath } from '../../../model/product/layout.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';

/**
 * 題材の木で試験を実行する vitest の設定に置く行(`expect.requireAssertions`)。assertion を 1 つも持たない it は実行時に赤になる
 * (生成器は見るものの無い試験を出さない。出す試験には、落ちうる assertion が 1 つ以上ある — その決まりの実行時の網)。
 * 配線の段・実 DB の段・構造の突合の段の設定がこの 1 行を共有する(アプリ本体の vitest の設定と同じ約束)。
 */
export const REQUIRE_ASSERTIONS_LINE = '    expect: { requireAssertions: true },';

/** 実装の木を決める(無ければ通し実行の段取りそのものが組めない)。 */
function appOf(roots: ProductRoots): string {
  if (roots.app === null) throw new Error('fixture の宣言に app が無いため、生成物の型検査を組めません');
  return roots.app;
}

/**
 * 基盤の層の土台(置き場の配置が宣言する層と土台の表の 1 行)の置き場(リポジトリルート相対)。
 *
 * @param roots その題材が宣言した根
 * @param layout 置き場の配置
 * @param base 層の名前と、層の直下からの土台のパス
 * @returns 置き場
 */
export function sampleBaseDir(roots: ProductRoots, layout: ProductLayout, base: { readonly layer: string; readonly dir: string }): string {
  const found = layoutBaseDirPath(layout, appOf(roots), base.layer, base.dir);
  if (found === null) throw new Error(`置き場の配置が土台 ${base.layer}/${base.dir} を宣言していないため、通し実行の一時ツリーを組めません`);
  return found;
}

/** 基盤の層のテスト支援の土台(突合のテストの置き場。コアが前提にする土台)。 */
export function sampleInfrastructureTests(roots: ProductRoots, layout: ProductLayout): string {
  return sampleBaseDir(roots, layout, CORE_REQUIRED_BASE_DIRS.infrastructureTests);
}

/**
 * 実装のソースの根(リポジトリルート相対)。
 *
 * @param roots その題材が宣言した根
 * @param layout 置き場の配置
 * @returns ソースの根
 */
export function sampleSourceRoot(roots: ProductRoots, layout: ProductLayout): string {
  const found = sourceRootPath(layout, roots);
  if (found === null) throw new Error('置き場の配置が source-root を宣言していないため、通し実行の一時ツリーを組めません');
  return found;
}

/**
 * ソースの根を指す import の別名(`@/…` の `@`)。
 *
 * @param layout 置き場の配置
 * @returns 別名(区切り `/` を含まない)
 */
export function sampleSourceAlias(layout: ProductLayout): string {
  const found = layoutModule(layout, 'source-root');
  if (found === null) throw new Error('置き場の配置が source-root の module(import の別名)を宣言していないため、通し実行の一時ツリーを組めません');
  return found;
}
