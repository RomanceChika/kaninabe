/**
 * 先掴みの計画の同じ表の文の畳み(`rpc-lock-merge.ts`。持ち主は `rpc-body-lock.ts` の lockPlan。点検 fix26 5 回目 D26e-1)のユニットテスト。
 *
 * - 同じ表に文が 2 つ以上あれば強さを問わず 1 文に畳む(各文の選び方の和・id の昇順・強い方。点検 fix26 6 回目 D26f-1)。1 文だけの表は畳まない
 * - 点検の台本 round5/p/move-folder の形(付け替えの編集が、書いた後の新しい親を排他で・書く前の古い親を共有で、別の文で掴む)は 1 文になる
 */

import { describe, expect, it } from 'vitest';
import { mergeSameTable } from '../../../lib/sql/rpc-lock-merge.js';
import type { LockTarget } from '../../../lib/sql/rpc-body-lock.js';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 計画の 1 行。 */
function lock(table: string, alias: string, mode: 'share' | 'update', extra: Partial<LockTarget> = {}): LockTarget {
  return { table, key: alias, alias, from: [`public.${table} ${alias}`], where: [`${alias}.id = p_${alias}`], order: null, mode, ids: [], ...extra };
}

describe('mergeSameTable', () => {
  it('同じ表に排他を含む 2 文があれば、最初の文の位置に 1 文で畳む(選び方の和・id の昇順・排他・行の決まり方は和)', () => {
    const merged = mergeSameTable([lock('a', 'x0', 'share'), lock('b', 'c0', 'update', { ids: [{ column: 'b_id' }] }), lock('b', 'l0', 'share', { order: 'l0.id' })]);
    expect(merged).toEqual([
      lock('a', 'x0', 'share'),
      {
        table: 'b',
        key: 'c0+l0',
        alias: 'lm0',
        from: ['public.b lm0'],
        where: ['lm0.id in (select c0.id from public.b c0 where c0.id = p_c0 union select l0.id from public.b l0 where l0.id = p_l0)'],
        order: 'lm0.id',
        mode: 'update',
        ids: [{ column: 'b_id' }],
      },
    ]);
  });

  it('共有だけの 2 文も 1 文に畳み、共有のまま掴む(点検 fix26 6 回目 D26f-1: 共有の 2 文の間に別の txn の排他の 1 文が挟まると輪になる)', () => {
    const merged = mergeSameTable([lock('b', 'l0', 'share'), lock('b', 'la', 'share'), lock('c', 't', 'update')]);
    expect(merged.map((row) => `${row.table}:${row.alias}:${row.mode}:${row.order ?? ''}`)).toEqual(['b:lm0:share:lm0.id', 'c:t:update:']);
  });

  it('1 文だけの表は畳まない', () => {
    const plan = [lock('b', 'g0', 'share'), lock('c', 't', 'update')];
    expect(mergeSameTable(plan)).toEqual(plan);
  });

  it('作成の冪等キーの行は、畳んだ文の全部がそうであるときだけ印を残す', () => {
    expect(mergeSameTable([lock('b', 't', 'update', { createKey: true }), lock('b', 'c0', 'share')])[0]?.createKey).toBeUndefined();
    expect(mergeSameTable([lock('b', 't', 'update', { createKey: true }), lock('b', 'c0', 'update', { createKey: true })])[0]?.createKey).toBe(true);
  });
});

describe('点検の台本 move-folder の形(付け替えの編集が同じ表の新旧の親を別の文で掴んでいた)', () => {
  const roles = roleSpec([role('member'), role('anonymous'), role('system'), { ...role('admin', undefined, ['member']), claim: 'staff.is_admin' }]);
  const staff = aggregate('staff', {
    entity: entitySpec('staff', { fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { required: true, session: true }), field('is_admin', { kind: 'boolean' }, { session: true })] }),
    access: accessSpec('staff', { writes: [write('admin', ['name'])] }),
  });
  const folder = aggregate('folder', {
    entity: entitySpec('folder', { context: { folder: 'folder.id' }, fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'folder' })] }),
    stateMachines: [machine('folder', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] })],
  });
  const item = aggregate('item', {
    entity: entitySpec('item', {
      context: { item: 'item.id', folder: 'item.folder_id' },
      fields: [field('id', { kind: 'uuid' }, { auto: true }), field('label', { kind: 'string' }), field('folder_id', { kind: 'ref', entity: 'folder' }, { required: true })],
    }),
    access: accessSpec('item', { writes: [write('admin', ['label', 'folder_id'], 'folder.state == open')] }),
  });
  const TABLES: Readonly<Record<string, string>> = { staff: 'staffs', folder: 'folders', item: 'items' };
  const params = ['p_item_id', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'];
  const args = ['uuid', 'jsonb', 'uuid', 'text[]', 'text[]'];

  it('新しい親(トリガの掴みの宣言の排他)と古い親(ガードの共有)が 1 文に id の順で排他に畳まれる', () => {
    const fn = { name: 'update_item', args, params, kind: 'rpc', shape: 'update', alsoWrites: [] };
    const trigger = { name: 'count_items', functionName: 'count_items', fires: 'after update of folder_id', deferred: false, supplies: [], params: {}, locks: { folders: 'update' as const } };
    const items = dataTable('items', {
      entity: 'item',
      foreignKeys: [{ column: 'folder_id', references: 'folders', onDelete: 'no_action' }],
      triggers: [trigger],
      resend: { returnsExisting: false, location: { file: 'x.md', pointer: 'resend' } },
      functions: [fn as unknown as DataTableSpec['functions'][number]],
    });
    const built = buildRpcBody({
      name: 'update_item',
      params,
      args,
      shape: 'update',
      table: items,
      tables: [items, dataTable('folders', { entity: 'folder' }), dataTable('staffs', { entity: 'staff' })],
      domain: specModel([staff, folder, item], roles),
      tableOf: (entity) => TABLES[entity] ?? null,
      actions: { actions: [actionSpec({ handles: 'item.update', input: ['item.label', 'item.folder_id'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      specFiles: ['x.md'],
      entityLabel: 'item',
      platform: TEST_PLATFORM,
    });
    expect(built.ok).toBe(true);
    const sql = built.ok ? built.sql : '';
    const folders = [...sql.matchAll(/ {4}perform 1\n {4}from public\.folders (\w+)\n((?: {4,}[^\n]*\n)*?) {4}for (share|update) of \1;/gu)];
    expect(folders.map((match) => `${match[1] ?? ''}:${match[3] ?? ''}`)).toEqual(['lm0:update']);
    expect(folders[0]?.[2]).toContain("then (p_changes ->> 'folder_id')::uuid else t.folder_id end");
    expect(folders[0]?.[2]).toContain('l0.id = t.folder_id');
    expect(folders[0]?.[2]).toContain('order by lm0.id');
  });
});
