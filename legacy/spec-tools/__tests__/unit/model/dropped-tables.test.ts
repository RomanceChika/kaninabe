/**
 * 落とした data_table の名前の扱い(`droppedTableName` / `droppedTableOfTcId`)。
 * 落とした表の宣言は信用しない代わりに、置き場のファイル名(`{table}.md`)・フロントマターの entity 名と、ID の綴り
 * (表の ID の系統の接頭辞のあとに、表名か entity 名を 1 区切りに持つ)だけを使う。
 */

import { describe, expect, it } from 'vitest';
import { droppedTableName, droppedTableOfTcId } from '../../../lib/model/data/dropped-tables.js';

describe('droppedTableName', () => {
  it.each([
    ['shelves.md', 'shelves'],
    ['sub/dir/shelf_items.md', 'shelf_items'],
    ['no_extension', 'no_extension'],
  ])('%s → %s', (file, name) => {
    expect(droppedTableName(file)).toBe(name);
  });
});

describe('droppedTableOfTcId', () => {
  const dropped = ['shelves.md', 'sub/shelf_items.md'];

  it.each([
    ['TC-TABLE-SHELVES-001', 'shelves'],
    ['TC-DDL-SHELVES-002', 'shelves'],
    ['TC-RLS-SHELF_ITEMS-003', 'shelf_items'],
    ['tc-table-shelves-001', 'shelves'],
  ])('%s は落とした表 %s の名前空間', (tcId, table) => {
    expect(droppedTableOfTcId(tcId, dropped)).toBe(table);
  });

  it.each([
    ['TC-TABLE-OTHER-001'],
    ['TC-TABLE-SHELVES_LOG-001'],
    ['TC-TABLE-MYSHELVES-001'],
  ])('%s はどの落とした表の名前空間でもない(部分一致は入れない)', (tcId) => {
    expect(droppedTableOfTcId(tcId, dropped)).toBeNull();
  });

  it('落とした表が無ければ常に null', () => {
    expect(droppedTableOfTcId('TC-TABLE-SHELVES-001', [])).toBeNull();
  });
});

describe('droppedTableOfTcId: EQ 系(単数形の entity 名)と、系統の接頭辞による絞り込み', () => {
  const dropped = ['check_items.md', 'sub/gadget_parts.md'];
  const entities = { 'check_items.md': 'check_item', 'sub/gadget_parts.md': 'gadget_part' };

  it.each([
    ['TC-EQ-CHECK_ITEM-0001', 'check_items'],
    ['TC-EQ-GADGET_PART-0002', 'gadget_parts'],
    ['TC-EQ-CHECK_ITEMS-0001', 'check_items'],
    ['TC-RLS-CHECK_ITEMS-001', 'check_items'],
    ['tc-eq-check_item-0003', 'check_items'],
  ])('%s は落とした表 %s の名前空間(EQ 系は entity 名の単数形も数える)', (tcId, table) => {
    expect(droppedTableOfTcId(tcId, dropped, entities)).toBe(table);
  });

  it('entity 名を知らない表(フロントマターから読めなかった)の EQ 系は、単数形を推測しない', () => {
    expect(droppedTableOfTcId('TC-EQ-CHECK_ITEM-0001', dropped)).toBeNull();
    expect(droppedTableOfTcId('TC-EQ-CHECK_ITEM-0001', dropped, {})).toBeNull();
  });

  it.each([
    ['TC-TABLE-CHECK_ITEM-001'],
    ['TC-DDL-CHECK_ITEM-001'],
    ['TC-RLS-CHECK_ITEM-001'],
  ])('%s: EQ 系でない系統は単数形の entity 名を名前空間に数えない', (tcId) => {
    expect(droppedTableOfTcId(tcId, dropped, entities)).toBeNull();
  });

  it.each([
    ['TC-GUAR-CHECK_ITEMS-001'],
    ['TC-SCREEN-CHECK_ITEMS-001'],
    ['TC-ACTION-CHECK_ITEMS-001'],
    ['TC-EQ-UC_CHECK_ITEM-0001'],
    ['CHECK_ITEMS-TC-TABLE-001'],
  ])('%s: 表の ID の系統の接頭辞を持たない ID は、同じ綴りの区切りがあっても表の名前空間に吸わない', (tcId) => {
    expect(droppedTableOfTcId(tcId, dropped, entities)).toBeNull();
  });
});
