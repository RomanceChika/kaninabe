/**
 * 行が作った後に消えうる表の全部(`removableTables`。行が消える経路の全数の表の正。点検 24 回目 A の観察 O24-2)のテスト。
 *
 * 表: 集約の表(access の deletes・消せる集約の連鎖・RPC の副作用の削除)× 内部テーブル(副作用の削除・保持の時間・消えうる表を指す連鎖・消えない表を指す連鎖)。
 */

import { describe, expect, it } from 'vitest';
import { removableTables, rowsRemovable } from '../../../lib/semantics/row-removal.js';
import type { DataFunctionDecl } from '../../../lib/model/data/types.js';
import { accessSpec, aggregate, deleteRule, entitySpec, field, specModel } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

const key = (column: string, references: string, onDelete: 'cascade' | 'restrict' = 'cascade') => ({ column, references, onDelete });
const NAME = { kind: 'string' } as const;

/** 副作用で `table` を消す RPC。 */
function sweeping(table: string): DataFunctionDecl {
  return { name: `sweep_${table}`, args: [], params: [], kind: 'rpc', shape: 'composite', handwritten: '掃除', alsoWrites: [table], alsoWriteKinds: { [table]: ['delete'] }, selfWriteKinds: ['update'] } as unknown as DataFunctionDecl;
}

const DOMAIN = specModel({
  aggregates: [
    aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME)]) }),
    aggregate({ name: 'slot', entity: entitySpec('slot', [field('title', NAME)]), access: accessSpec('slot', { deletes: [deleteRule('member')] }) }),
    aggregate({ name: 'venue', entity: entitySpec('venue', [field('title', NAME)]) }),
    aggregate({ name: 'note', entity: entitySpec('note', [field('title', NAME)]) }),
  ],
});

const TABLES = [
  dataTable('members', { entity: 'member', functions: [sweeping('notes'), sweeping('outbox')] }),
  dataTable('slots', { entity: 'slot' }),
  dataTable('venues', { entity: 'venue' }),
  dataTable('notes', { entity: 'note' }),
  dataTable('outbox', { internal: true }),
  dataTable('digests', { internal: true, retentionHours: 24 }),
  dataTable('slot_keys', { internal: true, foreignKeys: [key('slot_id', 'slots')] }),
  dataTable('slot_key_marks', { internal: true, foreignKeys: [key('key_id', 'slot_keys')] }),
  dataTable('venue_keys', { internal: true, foreignKeys: [key('venue_id', 'venues')] }),
  dataTable('slot_refs', { internal: true, foreignKeys: [key('slot_id', 'slots', 'restrict')] }),
  dataTable('ledger', { internal: true }),
];

/** 自表を全部消して入れ直す RPC(`self_writes: [delete, insert]`)。 */
const replacing: DataFunctionDecl = { name: 'replace_cache', args: [], params: [], kind: 'rpc', shape: 'composite', handwritten: '全入れ替え', alsoWrites: [], alsoWriteKinds: {}, selfWriteKinds: ['delete', 'insert'] } as unknown as DataFunctionDecl;

describe('removableTables: 自表の削除と、宣言の外の表からの連鎖', () => {
  const tables = [
    dataTable('members', { entity: 'member', foreignKeys: [key('id', 'auth.users')] }),
    dataTable('venues', { entity: 'venue', foreignKeys: [key('owner_id', 'auth.users', 'restrict')] }),
    dataTable('usage', { internal: true, foreignKeys: [key('member_id', 'members')] }),
    dataTable('cache', { internal: true, functions: [replacing] }),
    dataTable('ledger', { internal: true }),
  ];

  it('自表を消す RPC(self_writes の delete)の表・宣言の外の表(認証基盤の auth.users)を cascade で指す表と、その連鎖の先は消えうる', () => {
    expect(removableTables(DOMAIN, tables)).toEqual(['members', 'usage', 'cache']);
  });

  it('宣言の外の表を restrict で指す表・どの経路も無い表は数えない', () => {
    const removable = removableTables(DOMAIN, tables);
    for (const table of ['venues', 'ledger']) expect(removable).not.toContain(table);
  });

  it('宣言の外の表からの連鎖は操作でないので、操作で消えうるか(rowsRemovable。T28・T24・期待表の生成)には数えない', () => {
    expect(rowsRemovable(DOMAIN, tables, 'member')).toBe(false);
  });
});

describe('removableTables', () => {
  it('集約の表は rowsRemovable、内部テーブルは副作用の削除・保持の時間・消えうる表を指す連鎖(閉包)で消えうる(data_table の並び)', () => {
    expect(removableTables(DOMAIN, TABLES)).toEqual(['slots', 'notes', 'outbox', 'digests', 'slot_keys', 'slot_key_marks']);
  });

  it('集約の表の判定は rowsRemovable と同じ 1 つの定義(T28・T24 と共有)', () => {
    const entities = TABLES.filter((table) => table.entity !== undefined);
    expect(entities.filter((table) => removableTables(DOMAIN, TABLES).includes(table.table)).map((table) => table.table)).toEqual(
      entities.filter((table) => rowsRemovable(DOMAIN, TABLES, table.entity ?? '')).map((table) => table.table),
    );
  });

  it('消えない表を指す連鎖・restrict の外部キー・どの経路も無い内部テーブルは数えない', () => {
    const removable = removableTables(DOMAIN, TABLES);
    for (const table of ['venue_keys', 'slot_refs', 'ledger', 'members', 'venues']) expect(removable).not.toContain(table);
  });
});
