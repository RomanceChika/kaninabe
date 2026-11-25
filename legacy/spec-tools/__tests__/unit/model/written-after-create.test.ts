/**
 * 「作成の後に書き換わる列」の定義(`model/written-after-create.ts`。点検 21 回目 C の O21-1 で 3 か所の判定を 1 本にした)のユニットテスト。
 *
 * 固定するのは: 編集の `writes`・`transition_writes`・遷移の `records_time` / `records_actor` / `clears`・更新で発火する供給のトリガ・
 * 親の削除で書き換わる外部キーのどれか 1 つで「書き換わる」になること、表を渡さない呼び手(未ログインの作成の天井)は宣言だけを数えること、
 * 発火の読みは呼び手が渡す関数(`model/trigger-fires.ts` の `firesOnUpdate`)で決まること。
 */

import { describe, expect, it } from 'vitest';
import { rewrittenAfterCreate, writtenByDeclaration } from '../../../lib/model/written-after-create.js';
import { firesOnUpdate } from '../../../lib/model/trigger-fires.js';
import type { AggregateSpecs } from '../../../lib/model/types.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, read, specModel, write } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 枠の集約(編集・遷移の宣言を差し替える)。 */
function slot(opts: { readonly writes?: readonly string[]; readonly transitionWrites?: readonly string[]; readonly records?: { readonly recordsTime?: readonly string[]; readonly recordsActor?: readonly string[]; readonly clears?: readonly string[] } } = {}): AggregateSpecs {
  const model = specModel([
    aggregate('slot', {
      entity: entitySpec('slot', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('owner_id', { kind: 'ref', entity: 'slot' }), field('note', { kind: 'string' }), field('state', { kind: 'state', machine: 'slot' })] }),
      stateMachines: [machine('slot', { states: ['draft', 'done'], initial: 'draft', events: [event('finish', { from: ['draft'], to: 'done', by: ['member'], ...(opts.records ?? {}) })] })],
      access: { ...accessSpec('slot', { reads: [read('member', 'all')], writes: [write('member', [...(opts.writes ?? [])])] }), transitionWrites: [...(opts.transitionWrites ?? [])] },
    }),
  ]);
  const specs = model.aggregates.get('slot');
  if (specs === undefined) throw new Error('題材の組み立てが失敗しています');
  return specs;
}

/** 枠の表(トリガと外部キーを差し替える)。 */
function table(extra: Partial<DataTableSpec> = {}): DataTableSpec {
  return dataTable('slots', { entity: 'slot', ...extra });
}

describe('作成の後に書き換わる列(1 本の定義)', () => {
  it.each([
    ['編集の writes', slot({ writes: ['owner_id'] }), table(), true],
    ['transition_writes', slot({ transitionWrites: ['owner_id'] }), table(), true],
    ['遷移の records_time', slot({ records: { recordsTime: ['owner_id'] } }), table(), true],
    ['遷移の records_actor', slot({ records: { recordsActor: ['owner_id'] } }), table(), true],
    ['遷移の clears', slot({ records: { clears: ['owner_id'] } }), table(), true],
    ['更新で発火する供給のトリガ', slot(), table({ triggers: [{ name: 't', functionName: 'f', fires: 'before insert or update', deferred: false, supplies: ['owner_id'], params: {} }] }), true],
    ['発火の宣言が無い供給のトリガ(発火する側に倒す)', slot(), table({ triggers: [{ name: 't', functionName: 'f', deferred: false, supplies: ['owner_id'], params: {} }] }), true],
    ['外部キーの set_null', slot(), table({ foreignKeys: [{ column: 'owner_id', references: 'slots', onDelete: 'set_null' }] }), true],
    ['外部キーの set_default', slot(), table({ foreignKeys: [{ column: 'owner_id', references: 'slots', onDelete: 'set_default' }] }), true],
    ['作成のときだけ発火する供給', slot(), table({ triggers: [{ name: 't', functionName: 'f', fires: 'before insert', deferred: false, supplies: ['owner_id'], params: {} }] }), false],
    ['外部キーの cascade(子の列は書き換わらず行が消える)', slot(), table({ foreignKeys: [{ column: 'owner_id', references: 'slots', onDelete: 'cascade' }] }), false],
    ['別の列だけを書く', slot({ writes: ['note'], records: { clears: ['note'] } }), table(), false],
  ] as const)('%s', (_title, specs, spec, wanted) => {
    expect(rewrittenAfterCreate('owner_id', specs, spec, firesOnUpdate)).toBe(wanted);
  });

  it('表を渡さない呼び手(未ログインの作成の天井)は、編集・遷移の宣言だけを数える', () => {
    expect(rewrittenAfterCreate('owner_id', slot({ records: { recordsActor: ['owner_id'] } }), undefined, firesOnUpdate)).toBe(true);
    expect(rewrittenAfterCreate('owner_id', slot(), undefined, firesOnUpdate)).toBe(false);
    expect(writtenByDeclaration('owner_id', slot({ writes: ['owner_id'] }))).toBe(true);
  });

  it('発火の読みは呼び手が渡す(model の層は発火の宣言を読まない)', () => {
    const supplied = table({ triggers: [{ name: 't', functionName: 'f', fires: 'before insert', deferred: false, supplies: ['owner_id'], params: {} }] });
    expect(rewrittenAfterCreate('owner_id', slot(), supplied, () => true)).toBe(true);
    expect(rewrittenAfterCreate('owner_id', slot(), supplied, () => false)).toBe(false);
  });

  it('firesOnUpdate: 更新を含む・読めない・無い宣言は発火する側', () => {
    expect([firesOnUpdate('after update of a'), firesOnUpdate('before insert'), firesOnUpdate('xyz'), firesOnUpdate(undefined)]).toEqual([true, false, true, true]);
  });
});
