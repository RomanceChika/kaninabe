/**
 * testid の骨格の取り出し(`screen/testid-entries.ts`)のテスト。
 *
 * testid 定数表の生成とハンドブック「画面」の章が同じ走査を読む。スロット自身・部品・入れ子・重ね表示・操作を伴わない
 * 遷移の順と名前空間を固定する。
 */

import { describe, expect, it } from 'vitest';
import { layoutTestIds, screenTestIdEntries } from '../../../lib/screen/testid-entries.js';
import { layout, screenSpec } from '../../helpers/screen-builder.js';

describe('layoutTestIds', () => {
  it('スロット自身と、載る部品を宣言順に並べる。名前空間と前置きを付ける', () => {
    const entries = layoutTestIds(layout('f.md', [{ slot: 'header', components: ['title'] }, { slot: 'body.center', components: ['table'] }]), 'list');

    expect(entries.map((entry) => entry.value)).toEqual(['list.header', 'list.header.title', 'list.body.center', 'list.body.center.table']);
    expect(layoutTestIds(layout('f.md', [{ slot: 'header', components: ['title'] }]), 'list', 'overlay.confirm').map((entry) => entry.path)).toEqual([
      'overlay.confirm.header',
      'overlay.confirm.header.title',
    ]);
  });

  it('部品の入れ子のスロットは、親のパスを継ぐ', () => {
    const entries = layoutTestIds(
      layout('f.md', [
        { slot: 'body.center', components: ['panel'] },
        { slot: 'footer', owner: 'panel', components: ['bar'] },
      ]),
      'detail',
    );

    expect(entries.map((entry) => entry.value)).toEqual([
      'detail.body.center',
      'detail.body.center.panel',
      'detail.body.center.panel.footer',
      'detail.body.center.panel.footer.bar',
    ]);
  });
});

describe('screenTestIdEntries', () => {
  it('layout → 重ね表示 → 操作を伴わない遷移(nav.{on})の順。操作の結果の遷移と共有クローム由来の遷移は骨格を持たない', () => {
    const screen = screenSpec({
      name: 'detail',
      slots: [{ slot: 'body.center', components: ['table'] }],
      overlays: [{ id: 'confirm', actions: [] }],
      navigations: [
        { on: 'row_selected', to: 'screen-x' },
        { on: 'entry.create.success', to: 'screen-detail' },
        { on: 'home_link', to: 'screen-y', viaChrome: 'chrome-main' },
      ],
    });
    const values = screenTestIdEntries(screen).map((entry) => entry.value);

    expect(values[0]).toBe('detail.body.center');
    expect(values).toContain('detail.nav.row_selected');
    expect(values).not.toContain('detail.nav.home_link');
    expect(values.some((value) => value.includes('entry.create'))).toBe(false);
    expect(values.at(-1)).toBe('detail.nav.row_selected');
  });
});
