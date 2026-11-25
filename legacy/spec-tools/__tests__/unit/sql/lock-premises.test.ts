/**
 * 掴む順の判定の前提(作成の後に書き換わらない参照の列。`sql/lock-premises.ts`。点検 20 回目の後 11-06 01:37Z)のユニットテスト。
 *
 * 固定するのは: 参照の列だけを並べる・編集の `writes`・`transition_writes`・遷移の `records_actor` / `clears`・更新で発火する供給のトリガ・
 * 親の削除で書き換わる外部キーのどれかがあれば外す(前提が消えれば判定は覆いを言えず lock-order-parity が赤になる)・列の無い表は載せない。
 */

import { describe, expect, it } from 'vitest';
import { fixedReferenceColumnsOf } from '../../../lib/sql/lock-premises.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, read, specModel, write } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 枠(催し・部・持ち主を参照する)と、参照を持たない催し。 */
function domain(opts: { readonly writes?: readonly string[]; readonly recordsActor?: readonly string[] } = {}): SpecModel {
  return specModel([
    aggregate('show', { entity: entitySpec('show', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('title', { kind: 'string' })] }) }),
    aggregate('slot', {
      entity: entitySpec('slot', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('show_id', { kind: 'ref', entity: 'show' }, { required: true }),
          field('part_id', { kind: 'ref', entity: 'show' }),
          field('owner_id', { kind: 'ref', entity: 'show' }),
          field('note', { kind: 'string' }),
          field('state', { kind: 'state', machine: 'slot' }),
        ],
      }),
      stateMachines: [
        machine('slot', {
          states: ['draft', 'done'],
          initial: 'draft',
          events: [event('finish', { from: ['draft'], to: 'done', by: ['member'], ...(opts.recordsActor === undefined ? {} : { recordsActor: opts.recordsActor }) })],
        }),
      ],
      access: accessSpec('slot', { reads: [read('member', 'all')], writes: [write('member', [...(opts.writes ?? ['note'])])] }),
    }),
  ]);
}

const SLOTS = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('slots', { entity: 'slot', ...extra });

describe('fixedReferenceColumnsOf', () => {
  it('参照の列のうち、作成の後に書き換える宣言の無いものを並べる(参照でない列・参照を持たない表は載せない)', () => {
    expect(fixedReferenceColumnsOf([SLOTS(), dataTable('shows', { entity: 'show' })], domain())).toEqual([{ table: 'slots', columns: ['show_id', 'part_id', 'owner_id'] }]);
  });

  it.each<[string, SpecModel, DataTableSpec]>([
    ['編集の writes が書ける列', domain({ writes: ['note', 'show_id'] }), SLOTS()],
    ['遷移の records_actor', domain({ recordsActor: ['show_id'] }), SLOTS()],
    ['更新で発火する供給のトリガ', domain(), SLOTS({ triggers: [{ name: 'fill', functionName: 'fill', fires: 'before insert or update of part_id on slots', deferred: false, supplies: ['show_id'], params: {} }] })],
    ['親の削除で子の列を空にする外部キー', domain(), SLOTS({ foreignKeys: [{ column: 'show_id', references: 'shows', onDelete: 'set_null' }] })],
  ])('赤(前提から外す): %s', (_name, model, table) => {
    expect(fixedReferenceColumnsOf([table], model)[0]?.columns).not.toContain('show_id');
  });

  it('挿入だけで発火する供給のトリガ・削除の連鎖(cascade)は書き換えに数えない', () => {
    const table = SLOTS({
      triggers: [{ name: 'fill', functionName: 'fill', fires: 'before insert on slots', deferred: false, supplies: ['show_id'], params: {} }],
      foreignKeys: [{ column: 'show_id', references: 'shows', onDelete: 'cascade' }],
    });
    expect(fixedReferenceColumnsOf([table], domain())[0]?.columns).toContain('show_id');
  });
});
