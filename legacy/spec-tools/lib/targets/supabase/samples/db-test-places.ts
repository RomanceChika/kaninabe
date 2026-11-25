/**
 * 通し実行が実 DB に当てる**生成テストの置き場**を、置き場の配置の役割から引く口。
 *
 * 通し実行は 2 か所で同じ置き場を要る —— 生成物から実行するテストのファイルを種類ごとに拾う口(`db-tests.ts`)と、一時ツリーに置く vitest の設定の
 * `include`(`db-tree.ts`)。以前は両者が `infrastructure/__tests__/generated/equivalence` などを別々に綴っていて、片方だけ動かすと
 * 「拾うのに実行されない」「実行するのに拾われない」が静かに起きえた。**どちらもこの口を通る**(置き場の綴りは配置の値にだけある)。
 *
 * 引く役割は、実 DB で実行する 3 種 —— 一致の証明(`eq-test` = 集約ごと・`eq-save-test` = 保存点ごと)と RLS の挙動(`rls-test`)。
 * 役割の逆引き(`classify`)の根が、そのまま「その種類のテストの置き場」である。
 */

import { layoutScan } from '../../../model/product/layout.js';
import type { ClassifiedRole, ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 一致の証明(集約ごと + 保存点ごと)の役割。 */
export const EQUIVALENCE_TEST_ROLES: readonly ClassifiedRole[] = ['eq-test', 'eq-save-test'];

/** RLS の挙動テストの役割。 */
export const RLS_TEST_ROLES: readonly ClassifiedRole[] = ['rls-test'];

/**
 * 役割の置き場の印(リポジトリルート相対。末尾に `/`)。
 *
 * 実装の木を宣言していない製品・配置に逆引きを持つ役割が無い構成では 1 本も無い —— そのとき生成テストも生成されないので、
 * 「印が無い = 拾えるものが無い」で辻褄が合う(空文字の接頭辞にすると全件が当たってしまう)。
 *
 * @param layout 置き場の配置
 * @param roots その題材が宣言した根
 * @param roles 引く役割
 * @returns 置き場の印の並び
 */
export function generatedTestDirs(layout: ProductLayout, roots: ProductRoots, roles: readonly ClassifiedRole[]): readonly string[] {
  return roles.flatMap((role) => {
    const scan = layoutScan(layout, roots.app, role);
    return scan === null ? [] : [`${scan.dir}/`];
  });
}

/**
 * vitest の設定の `include`(実装の木の根からの相対。一時ツリーの `app/` を root にする)。末尾の `*.test.ts` はテスト実行系(vitest)の名前の規約で、配置の値ではない
 * (実 DB で実行する 3 種の生成テストは、配置が `.test.ts` で終わる名前に置くこと)。
 *
 * @param layout 置き場の配置
 * @param roles 引く役割
 * @returns glob の並び(役割ごとに置き場の下の全テスト)
 */
export function generatedTestIncludes(layout: ProductLayout, roles: readonly ClassifiedRole[]): readonly string[] {
  return roles.flatMap((role) => {
    const scan = layoutScan(layout, '', role);
    return scan === null ? [] : [`${scan.dir}/**/*.test.ts`];
  });
}

/**
 * 置き場の印を決められない役割(実装の木があるのに、配置が逆引きを宣言していない・基準が辿れない)。**拾う口が黙って 0 本になる原因**として、
 * 通し実行が「生成されていません」と言うときに名指すために引く(実装の木を持たない製品は置き場が無いのが事実なので、ここには入らない)。
 *
 * @param layout 置き場の配置
 * @param roots その題材が宣言した根
 * @param roles 引く役割
 * @returns 置き場の印を決められない役割(無ければ空)
 */
export function unplacedTestRoles(layout: ProductLayout, roots: ProductRoots, roles: readonly ClassifiedRole[]): readonly ClassifiedRole[] {
  if (roots.app === null) return [];
  return roles.filter((role) => layoutScan(layout, roots.app, role) === null);
}
