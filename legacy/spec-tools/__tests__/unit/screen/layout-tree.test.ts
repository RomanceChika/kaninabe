/**
 * 平坦なスロット列 → 宣言順の木(lib/screen/layout-tree.ts)のテスト。
 *
 * 対象の要求: 「フルパスを頼りに入れ子を復元する。同じ名前のスロットが 2 か所にあっても
 * 取り違えない」。ここが崩れると、ワイヤーフレームと testid の並びが同時に狂う。
 */

import { describe, expect, it } from 'vitest';
import { layoutTree } from '../../../lib/screen/layout-tree.js';
import { layout } from '../../helpers/screen-builder.js';

const FILE = 'docs/specs/frontend/screens/workshop/workshop_detail.md';

describe('layoutTree', () => {
  it('トップレベルのスロットを宣言順に返す', () => {
    const tree = layoutTree(
      layout(FILE, [
        { slot: 'header', components: ['page_title'] },
        { slot: 'body.center', components: ['workshop_summary'] },
      ]),
    );

    expect(tree.map((node) => node.slot.slot)).toEqual(['header', 'body.center']);
    expect(tree[0]?.components.map((child) => child.component.name)).toEqual(['page_title']);
  });

  it('入れ子スロットは、それを持つ部品の下にだけ現れる', () => {
    const tree = layoutTree(
      layout(FILE, [
        { slot: 'body.center', components: ['own_entry_panel', 'entry_form'] },
        { slot: 'footer', components: ['submit_bar'], owner: 'own_entry_panel', under: 'body.center' },
      ]),
    );

    const [center] = tree;
    expect(center?.components.map((child) => child.component.name)).toEqual([
      'own_entry_panel',
      'entry_form',
    ]);
    expect(center?.components[0]?.slots.map((child) => child.slot.path)).toEqual([
      'body.center.own_entry_panel.footer',
    ]);
    // 兄弟の部品には付かない(所有者を見ずにパスの前方一致だけで拾うと起きる取り違え)。
    expect(center?.components[1]?.slots).toEqual([]);
  });

  it('同じ名前のスロットがトップと入れ子の両方にあっても混ざらない', () => {
    const tree = layoutTree(
      layout(FILE, [
        { slot: 'body.center', components: ['own_entry_panel'] },
        { slot: 'footer', components: ['submit_bar'], owner: 'own_entry_panel', under: 'body.center' },
        { slot: 'footer', components: ['page_footer'] },
      ]),
    );

    const top = tree.find((node) => node.slot.path === 'footer');
    expect(top?.components.map((child) => child.component.name)).toEqual(['page_footer']);
    expect(tree).toHaveLength(2);
  });

  it('宣言の無い layout は空の木になる', () => {
    expect(layoutTree({ declared: false, slots: [], location: { file: FILE } })).toEqual([]);
  });
});
