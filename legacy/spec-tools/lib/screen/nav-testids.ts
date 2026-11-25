/**
 * `navigations` のうち、`layout` の部品と対応しない遷移元(操作を伴わない・共有クロームから
 * 継承していない)から testid の骨格を導く共有ロジック。
 *
 * 骨格は `nav.{on}` の形になる(名前空間は画面名 or chrome 名)。この判定(どの navigations が
 * 対象か)は 2 つの生成器が使う — testid 定数表(code-testids.ts)と画面の配線表
 * (code-screens.ts。screenTest の突合対象を持つ)であり、判定基準がずれると
 * 「定数はあるのに screenTest が未宣言として落ちる」事故になるため、正をここ 1 つに置く。
 *
 * 対象外にする 2 つ:
 * - `on` がドットを含む(`{event}.success` 形) … `actions` 経由で `layout` に骨格を既に持つ
 * - `viaChrome` を持つ(共有クロームから展開された) … 骨格は展開元の chrome の表が持つ
 */

import type { ScreenNavigation } from '../model/screen/types.js';

/** `nav.{on}` の骨格 1 本。 */
export interface NavTestIdEntry {
  /** スロットパス相当のキー(`nav.{on}`)。 */
  readonly path: string;
  /** 実際の testid(`{namespace}.nav.{on}`)。 */
  readonly value: string;
}

/**
 * 対象になる navigations から `nav.{on}` の骨格を導く。
 *
 * @param navigations - 画面または chrome の `navigations`(宣言順)
 * @param namespace - testid の名前空間(画面名 or chrome 名)
 * @returns 骨格(宣言順)
 */
export function navTestIdEntries(
  navigations: readonly ScreenNavigation[],
  namespace: string,
): readonly NavTestIdEntry[] {
  return navigations
    .filter((nav) => nav.viaChrome === undefined && !nav.on.includes('.'))
    .map((nav) => ({ path: `nav.${nav.on}`, value: `${namespace}.nav.${nav.on}` }));
}
