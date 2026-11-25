/**
 * `spec:diff` の結果を **公理 / 導出** に分ける(book-human-face.md §7-2・§7-5)。
 *
 * 6 軸の行は、どれも機械が出した結果(結果表・実行計画・RLS・API のビュー・遷移表・画面の配線)の差で、
 * **導出の側**である —— 公理を変えた帰結であって、読まなくても公理の判定は変わらない。人が読む
 * 「今回変わった」は、**公理そのもの**(`axioms.ts`)が動いたかである。
 *
 * 軸 → 要素の種類の表は `Record<DiffAxis, …>` なので、軸を足すと**ここで分類を書かない限り型が通らない**
 * (導出と決めつけて黙って落とさない)。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ReadingClass, ReadingElement } from '../semantics/reading-class.js';
import { readingClassOf } from '../semantics/reading-class.js';
import type { ReadingChange } from '../semantics/reading-change.js';
import type { DiffAxis, DiffOutcome, SemanticChange } from './types.js';

/** 6 軸が見ている生成物の種類(分類の表の鍵)。 */
export const AXIS_ELEMENT: Readonly<Record<DiffAxis, ReadingElement>> = {
  permission: 'result.table',
  operations: 'execution.plan',
  rows: 'rls.policy',
  columns: 'api.view',
  notifications: 'transition.table',
  screens: 'screen.wiring',
};

/** 軸の分類。 */
export function axisClass(axis: DiffAxis): ReadingClass {
  return readingClassOf(AXIS_ELEMENT[axis]);
}

/** 公理 / 導出に分けた差分。 */
export interface ReadingSplit {
  /** 公理の側(人が読む)。 */
  readonly axiom: readonly ReadingChange[];
  /** 導出の側(機械が出した結果。6 軸)。 */
  readonly derived: readonly SemanticChange[];
}

/**
 * 差分を公理 / 導出に分ける。
 *
 * @param outcome 6 軸の差分
 * @param axiom 公理の側の差分(`axiomChanges` の結果)
 */
export function splitByReading(outcome: DiffOutcome, axiom: readonly ReadingChange[]): ReadingSplit {
  return {
    axiom: axiom.filter((change) => readingClassOf(change.element) === 'axiom'),
    derived: outcome.changes.filter((change) => axisClass(change.axis) === 'derived'),
  };
}
