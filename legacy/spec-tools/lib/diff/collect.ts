/**
 * 6 軸の判定器を 1 回ずつ回し、行を並べ替えてまとめる段。
 *
 * 並べ替えの規則は 1 つだけ —— **🔓(広がった)を先頭に**集める。権限・可視・公開が増える
 * 変化はレビューの主役であり、見落とすと「誰かに見えてはいけないものが見えている」が
 * 差分の途中に埋もれる(設計メモ §1)。その後は軸の宣言順・行の主語順に並べる。
 *
 * 権限の軸だけは判定器が 2 つある —— **結果表**(全列挙)と、それが答えを出していない操作を
 * 拾う**規則の表**である。後者に渡す「結果表が答えている操作」は前者が示す。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { columnChanges } from './api.js';
import { labelBook } from './labels.js';
import { notificationChanges } from './notifications.js';
import { operationChanges } from './ops.js';
import { permissionChanges } from './results.js';
import { rowChanges } from './rls.js';
import { ruleChanges } from './rules.js';
import { screenChanges } from './screens.js';
import type { AxisInput, AxisResult, DiffAxis, DiffOutcome, SemanticChange, SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/** 軸の並び(見出しの順でもある)。 */
const AXIS_ORDER: readonly DiffAxis[] = ['permission', 'operations', 'rows', 'columns', 'notifications', 'screens'];

/** 権限以外の 5 軸の判定器(登録した順に回る)。 */
const AXIS_RUNNERS: readonly ((input: AxisInput) => AxisResult)[] = [
  operationChanges,
  rowChanges,
  columnChanges,
  notificationChanges,
  screenChanges,
];

/** 並べ替えの鍵(🔓 が先頭、次は軸の宣言順、最後は主語)。 */
function sortKey(change: SemanticChange): string {
  const widened = change.direction === 'widened' ? '0' : '1';
  const axis = String(AXIS_ORDER.indexOf(change.axis));
  return `${widened}${axis}${change.subject}${change.text}`;
}

/**
 * 2 版の写しから意味の差分を組み立てる。
 *
 * @param base 基点側の写し
 * @param head 比較先の写し
 * @param roots 製品が宣言した根(差分の元の置き場)
 * @returns 行・読めなかったもの・突き合わせた本数
 */
export function semanticDiff(base: SideSnapshot, head: SideSnapshot, roots: ProductRoots): DiffOutcome {
  const input: AxisInput = { base, head, labels: labelBook([head, base], roots), roots };
  const permission = permissionChanges(input);
  const results = [permission, ruleChanges(input, permission.decidedOps), ...AXIS_RUNNERS.map((run) => run(input))];
  const changes = results
    .flatMap((result) => result.changes)
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
  const paths = new Set([...base.keys(), ...head.keys()]);
  const compared = [...paths].filter((path) => base.get(path) != null || head.get(path) != null).length;
  return {
    changes,
    problems: results.flatMap((result) => result.problems),
    comparedFiles: compared,
  };
}

/** 軸ごとの行(見出しの順)。 */
export function byAxis(
  changes: readonly SemanticChange[],
): readonly (readonly [DiffAxis, readonly SemanticChange[]])[] {
  return AXIS_ORDER.map((axis) => [axis, changes.filter((change) => change.axis === axis)] as const).filter(
    (entry) => entry[1].length > 0,
  );
}
