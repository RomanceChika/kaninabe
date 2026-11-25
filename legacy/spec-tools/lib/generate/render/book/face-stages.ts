/**
 * ライフサイクルの段(状態)の人向けの表示。`<Steps>` に、段ごとのスロットを埋めて出す。
 *
 * 段 1 つの中身は**ラベル行と「出る手」の表だけ**で、文章は人が書く 1 文(状態の `summary`)の 1 つだけ
 * (book-human-face.md §7-7)。書かれていない段は「(まだ書かれていない)」になる —— 黙って空にしない。
 * 値はすべて仕様の宣言の写しで、数字を文に入れない。
 */

import type { StateMachineSpec } from '../../../model/types.js';

/** 段の表示名(label が無ければ英字 id)。 */
export function stateName(machine: StateMachineSpec, id: string): string {
  return machine.stateLabels[id] ?? id;
}

