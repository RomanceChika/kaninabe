/**
 * 画面の章の下段(導出): 動線の図・画面ごとの実物と構造・testid と遷移とテストの表。
 *
 * すべて折りたたむ。図の折りたたみは件数を持たない(図は数えられる項目ではない。遷移は画面ごとの表の行が数える)。
 * 画面ごとの折りたたみは、実物(SSR プレビュー)・構造・重ね表示・局所の動線・状態ごとの見え方のカードと、
 * **testid・遷移・テストの表 1 枚**を持ち、件数はその表の行の数である(遷移は画面固有のものだけ。共有クロームから
 * 継承した遷移は、骨格を持つクローム側にあるので含めない)。
 */

import type { ScreenSpec } from '../../../model/screen/types.js';
import { screenTestIdEntries } from '../../../screen/testid-entries.js';
import { cell } from '../../../gen-kit/state-machine-table.js';

/** 画面の導出の種類(折りたたみ 1 つが載せる)。 */
export const SCREEN_ELEMENTS = ['screen.preview', 'screen.navigation', 'screen.testid', 'screen.tests'] as const;

/** 画面固有の遷移(共有クロームから継承したものを除く)。 */
export function ownNavigations(screen: ScreenSpec): ScreenSpec['navigations'] {
  return screen.navigations.filter((nav) => nav.viaChrome === undefined);
}

/** 画面ごとの表の行(testid → 遷移 → テスト)。件数はこの行の数。 */
export function screenDerivedRows(screen: ScreenSpec): string[][] {
  return [
    ...screenTestIdEntries(screen).map((entry) => ['testid', cell(`\`${entry.value}\``), '—']),
    ...ownNavigations(screen).map((nav) => ['遷移', cell(`\`${nav.on}\``), cell(`\`${nav.to}\``)]),
    ...screen.testCases.map((testCase) => [
      'テスト',
      cell(testCase.id),
      cell(`${testCase.type}${testCase.covers === undefined ? '' : ` ${testCase.covers.join(',')}`} — \`${testCase.implementation.raw}\``),
    ]),
  ];
}

/** 画面 1 枚の折りたたみの見出し(題・件数・添え書き)。HTML 版の章も同じ語を使う。 */
export function screenFoldHead(screen: ScreenSpec): { readonly title: string; readonly count: number; readonly hint: string } {
  const inherited = screen.navigations.length - ownNavigations(screen).length;
  return {
    title: `${screen.name}${screen.label === undefined ? '' : ` — ${screen.label}`}`,
    count: screenDerivedRows(screen).length,
    hint: `実物・構造・動線のカードと、testid・遷移・テストの表${inherited === 0 ? '' : `。共有クロームの遷移 ${inherited} 本は含めない`}`,
  };
}

