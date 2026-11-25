/**
 * 落とした表の名前(操作の属性の導出に使う検査が見ていないことを、表の名前つきで言うための材料。入力の状態-f / -g)。
 * 落とした表が無ければ空。ある(仕様を落とした阻害)ときだけ、表の名前を返す。行にするのは `operation-input-notes.ts`。
 */

import { describe, expect, it } from 'vitest';
import { availableLoad, catalogInput } from '../../../lib/kernel/input-state.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import { droppedTableSubjects } from '../../../lib/verify/dropped-table-notes.js';

const DROPPED: DataTableSpecModel = { available: true, tables: [], droppedTables: ['shelves.md', 'sub/stock_moves.md'] };

describe('落とした表の名前', () => {
  it('落とした表があれば、表の名前(ファイル名から導く)を返す', () => {
    expect(droppedTableSubjects(catalogInput('selected', availableLoad(DROPPED, [], 2)))).toEqual(['shelves', 'stock_moves']);
  });

  it('落とした表が無い(読込済み・未選択・置き場が無い阻害)なら空', () => {
    const clean: DataTableSpecModel = { available: true, tables: [] };

    expect(droppedTableSubjects(catalogInput('selected', availableLoad(clean)))).toEqual([]);
    expect(droppedTableSubjects(catalogInput('unselected', availableLoad(clean)))).toEqual([]);
    expect(droppedTableSubjects(catalogInput('selected', availableLoad({ available: false, tables: [] })))).toEqual([]);
  });
});
