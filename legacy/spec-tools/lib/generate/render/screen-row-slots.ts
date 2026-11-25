/**
 * 表の生成物(読むだけの表・操作を載せる表)が共有する**行の口の字面**(行のリンク・行ごとの差し込み)。
 *
 * - **行のリンク**: 生成物が自分で href を組む。宣言から導けるもの(`navigations` の遷移先の `route` と、行の `id`)
 *   だけで足りるので、器から関数を渡さない — 生成物が `'use client'`(フックを呼ぶ表)でも、server の器から渡せる形になる
 *   (関数の props は server から client へ渡せない)。
 * - **行ごとの差し込み**(層 (c)): 器が行ごとに描いた node を `rowExtras`(鍵は行の `id`)で渡し、見出しは文字列
 *   (`rowExtraHeader`)で渡す。node は server → client の境界を越えられる。
 *
 * この字面に業務の判断は 1 つも無い(W1)。
 */

import { docComment, tsString } from '../../gen-kit/code-emit.js';
import { screenTestIdsName } from './screen-form-plan.js';
import { ROW_KEY_FIELD } from './screen-read-cells.js';
import { rowKeyOf } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';
import type { BodyModules } from '../body-modules.js';

/** 行のリンクを持つか(遷移先が導けるとき)。 */
export function hasRowLink(plan: ScreenReadPlan): boolean {
  return plan.rowNav !== undefined && plan.rowNavTarget !== undefined;
}

/**
 * 行のリンクの import(`Link`・`screenRoutes`・動的セグメントを埋めるなら `screenPath`)。
 *
 * @param plan 生成の入力
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns import 文の行(リンクが無ければ空)
 */
export function rowLinkImportLines(plan: ScreenReadPlan, modules: BodyModules): readonly string[] {
  if (!hasRowLink(plan)) return [];
  return [
    "import Link from 'next/link';",
    ...(plan.rowNavTarget?.dynamic === true ? [`import { screenPath } from '${modules.component('screen-path')}';`] : []),
    `import { screenRoutes } from '${modules.generated('screens')}';`,
  ];
}

/**
 * 行のリンクの定数(リンクの testid と、遷移先の route)。
 *
 * @param plan 生成の入力
 * @returns 定数の宣言(doc コメント付き)の行(リンクが無ければ空)
 */
export function rowLinkConstLines(plan: ScreenReadPlan): readonly string[] {
  const nav = plan.rowNav;
  const target = plan.rowNavTarget;
  if (nav === undefined || target === undefined) return [];
  return [
    docComment(['行から遷移するリンクの testid(仕様の `navigations` の画面自身の遷移)。']),
    `const NAV_TESTID = ${screenTestIdsName(plan.screen)}[${tsString(nav)}];`,
    '',
    docComment(['行の遷移先の route(`screenRoutes` から引く。動的セグメントは行の `id` で埋める)。']),
    `const NAV_ROUTE = screenRoutes.${target.screen}.route;`,
    '',
  ];
}

/**
 * 行 1 つの href の宣言(`map` の中で使う)。
 *
 * @param plan 生成の入力
 * @returns 文の行(リンクが無ければ空)
 */
export function rowHrefLines(plan: ScreenReadPlan): readonly string[] {
  if (!hasRowLink(plan)) return [];
  return [
    plan.rowNavTarget?.dynamic === true
      ? `              const href = screenPath(NAV_ROUTE, row.${rowKeyOf(ROW_KEY_FIELD)});`
      : '              const href = NAV_ROUTE;',
  ];
}

/**
 * props の `rowExtras` / `rowExtraHeader`(層 (c) の差し込み)。
 *
 * @returns interface のメンバーの行
 */
export function rowExtrasPropLines(): readonly string[] {
  return [
    '  /**',
    '   * 行ごとに末尾の列へ差し込む手書きの部品(層 (c)。読みの欄で表せない案内・操作など)。鍵は行の `id`・値は器が行ごとに描いた node',
    '   * (関数ではなく node で受けるのは、生成物が `\'use client\'` でも server の器から渡せるため)。渡さなければ列は出ない。',
    '   */',
    '  readonly rowExtras?: Readonly<Record<string, ReactNode>> | undefined;',
    '  /** `rowExtras` の列の見出し(`rowExtras` を渡すときだけ使う。渡さなければ空の見出し)。 */',
    '  readonly rowExtraHeader?: string | undefined;',
  ];
}

/** 末尾の差し込みの見出しセル(`<tr>` の中)。 */
export const ROW_EXTRA_HEADER_LINES: readonly string[] = [
  '              {rowExtras === undefined ? null : (',
  '                <th className={styles.screenTableHead}>{rowExtraHeader ?? null}</th>',
  '              )}',
];

/**
 * 末尾の差し込みのセル(行の `id` で引く。行のループ変数の名前を渡す)。
 *
 * @param row 行を指す式(`row` / `item`)
 * @returns `<td>` の行
 */
export function rowExtraCellLine(row: string): string {
  return `                  {rowExtras === undefined ? null : <td className={styles.screenTableCell}>{rowExtras[${row}.${rowKeyOf(ROW_KEY_FIELD)}] ?? null}</td>}`;
}
