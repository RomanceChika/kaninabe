/**
 * 画面の testid の骨格(`{画面名}.{スロットのフルパス}.{部品}`)を宣言から取り出す共有ロジック。
 *
 * testid 定数表の生成(`generate/render/code-testids.ts`)と、ハンドブック「画面」の章が出す testid の一覧が、
 * **同じこの 1 本の走査**を読む。骨格が仕様の layout そのものなので、2 か所に書き写すと生成物と章が静かにずれる。
 * 純粋関数だけ。
 */

import { layoutTree, type SlotNode } from './layout-tree.js';
import { navTestIdEntries } from './nav-testids.js';
import type { ScreenLayout, ScreenSpec } from '../model/screen/types.js';

/** testid の骨格 1 本(スロット自身、またはスロットに載る部品)。 */
export interface TestIdEntry {
  /** 宣言の根からのパス(例: `body.center.own_entry_panel.footer.submit_bar`)。 */
  readonly path: string;
  /** 実際の testid(`{画面名 or chrome 名}.{path}`)。 */
  readonly value: string;
}

/**
 * レイアウトから testid の骨格を宣言順に取り出す。
 *
 * スロット自身も 1 本の testid になる(画面の器 = `<main data-testid="…body.center">` に付く)。
 * 部品はその下に続き、入れ子は親のパスを継ぐ。
 *
 * @param layout 平坦化済みのレイアウト
 * @param namespace 名前空間(画面名か共有クローム名)
 * @param prefix パスの前置き(重ね表示は `overlay.{id}`)
 */
export function layoutTestIds(layout: ScreenLayout, namespace: string, prefix?: string): readonly TestIdEntry[] {
  const found: TestIdEntry[] = [];
  const at = (path: string): string => (prefix === undefined ? path : `${prefix}.${path}`);
  const visit = (nodes: readonly SlotNode[]): void => {
    for (const node of nodes) {
      found.push({ path: at(node.slot.path), value: `${namespace}.${at(node.slot.path)}` });
      for (const child of node.components) {
        const path = at(`${node.slot.path}.${child.component.name}`);
        found.push({ path, value: `${namespace}.${path}` });
        visit(child.slots);
      }
    }
  };
  visit(layoutTree(layout));
  return found;
}

/**
 * 画面 1 枚の testid の骨格(layout → 重ね表示 → 操作を伴わない遷移の `nav.{on}`)。
 * 重ね表示は同じ表に `overlay.{id}.` を前置きにして載る(testid 定数表と同じ)。
 */
export function screenTestIdEntries(screen: ScreenSpec): readonly TestIdEntry[] {
  return [
    ...layoutTestIds(screen.layout, screen.name),
    ...screen.overlays.flatMap((overlay) => layoutTestIds(overlay.layout, screen.name, `overlay.${overlay.id}`)),
    ...navTestIdEntries(screen.navigations, screen.name),
  ];
}
