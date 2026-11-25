/**
 * 平坦化されたレイアウト(LayoutSlot の配列)を、宣言どおりの木に戻す純粋モジュール。
 *
 * モデルがスロットを平坦に持つのは検査(S6)がそのほうが素直に書けるからであり、
 * **人に見せる形**(ワイヤーフレーム)と **testid の並び**は宣言順の木でないと作れない。
 * 木を組み直す規則は 1 つしかないので、生成器ごとに書かずここへ集める。
 *
 * 復元の鍵はスロットのフルパスである。部品 `own_entry_panel` が スロット `body.center`
 * (パス `body.center`)に居るとき、その内側のスロットは必ずパス
 * `body.center.own_entry_panel.{スロット名}` を持つ(lib/model/screen/parse-layout.ts の平坦化規則)。
 */

import type { LayoutComponent, LayoutSlot, ScreenLayout } from '../model/screen/types.js';

/** 木にしたスロット 1 つ。 */
export interface SlotNode {
  readonly slot: LayoutSlot;
  /** このスロットに載る部品(宣言順。排他表示の部品も並びに含まれる)。 */
  readonly components: readonly ComponentNode[];
}

/** 木にした部品 1 つ。 */
export interface ComponentNode {
  readonly component: LayoutComponent;
  /** この部品の内側の入れ子スロット(宣言順)。入れ子が無ければ空。 */
  readonly slots: readonly SlotNode[];
}

/**
 * レイアウトを宣言順の木に戻す。
 *
 * @param layout 平坦化済みのレイアウト
 * @returns トップレベルのスロット(宣言順)。`declared: false` のときは空
 */
export function layoutTree(layout: ScreenLayout): readonly SlotNode[] {
  const top = layout.slots.filter((slot) => slot.owner === null);
  return top.map((slot) => toNode(slot, layout.slots));
}

/** スロット 1 つを木にする(部品ごとに入れ子スロットをぶら下げる)。 */
function toNode(slot: LayoutSlot, all: readonly LayoutSlot[]): SlotNode {
  return {
    slot,
    components: slot.components.map((component) => ({
      component,
      slots: childSlots(slot, component, all).map((child) => toNode(child, all)),
    })),
  };
}

/** 部品の内側の入れ子スロット(フルパスの前置きが `{親スロットのパス}.{部品名}` のもの)。 */
function childSlots(
  parent: LayoutSlot,
  component: LayoutComponent,
  all: readonly LayoutSlot[],
): readonly LayoutSlot[] {
  const prefix = `${parent.path}.${component.name}.`;
  return all.filter((slot) => slot.owner === component.name && slot.path === `${prefix}${slot.slot}`);
}
