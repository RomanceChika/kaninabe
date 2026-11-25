/**
 * 本文が生成物の条件のトリガが掴む親の行(`lib/model/data/check-trigger-locks.ts` の `impliedLocksOf`。fix25s)のユニットテスト。
 *
 * 参照の欄が指す行を読む条件は読む行の全部を、2 つの集約の一致の行の側(遅延)は相手の行を、どちらも共有で掴む。手書きの本文・相手の側・
 * 条件でないトリガは数えない(宣言の `locks` が要る)。
 */

import { describe, expect, it } from 'vitest';
import { beforeUpgradesOf, impliedLocksOf } from '../../../lib/model/data/check-trigger-locks.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 題材: 予約は部屋を必須の参照の欄で指す。 */
function domain(formal: InvariantFormal): SpecModel {
  return specModel(
    [
      aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('org_id', { kind: 'uuid' }, { required: true }), field('open', { kind: 'boolean' }, { required: true })] }) }),
      aggregate('booking', {
        entity: entitySpec('booking', {
          context: { room: 'booking.room_id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('room_id', { kind: 'ref', entity: 'room' }, { required: true }), field('org_id', { kind: 'uuid' }, { required: true })],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOKING-001', entities: ['booking', 'room'], statement: 's', formal })]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

const decl = (init: Partial<DataTriggerDecl>): DataTriggerDecl => ({ name: 'check_booking', functionName: 'check_booking', fires: 'before insert or update of room_id', deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-001', ...init });

function tables(trigger: DataTriggerDecl, handwritten = false, others: readonly DataTriggerDecl[] = []): readonly DataTableSpec[] {
  const functions = handwritten ? [{ name: 'check_booking', args: [], params: [], kind: 'trigger' as const, alsoWrites: [], handwritten: '理由' }] : [];
  return [dataTable('bookings', { entity: 'booking', triggers: [trigger, ...others], functions }), dataTable('rooms', { entity: 'room' })];
}

/** 同じ親を排他で掴む別の BEFORE トリガ(末尾の番号の採番の形)。 */
const numbering = (init: Partial<DataTriggerDecl> = {}): DataTriggerDecl => ({ name: 'number_booking', functionName: 'number_booking', fires: 'before insert', deferred: false, supplies: [], params: {}, locks: { rooms: 'update' }, ...init });

describe('本文が生成物の条件のトリガが掴む親の行', () => {
  it('参照の欄が指す行を読む条件は、読む行を共有で掴む', () => {
    const trigger = decl({});
    const all = tables(trigger);
    expect(impliedLocksOf(trigger, all[0] as DataTableSpec, domain({ kind: 'check', expr: 'room.open == true' }), all)).toEqual({ rooms: 'share' });
  });

  it('2 つの集約の一致の行の側(遅延)は、相手の行を共有で掴む', () => {
    const trigger = decl({ deferred: true, fires: 'after insert or update of room_id, org_id (constraint trigger, deferrable initially deferred)' });
    const all = tables(trigger);
    expect(impliedLocksOf(trigger, all[0] as DataTableSpec, domain({ kind: 'check', expr: 'booking.org_id == room.org_id' }), all)).toEqual({ rooms: 'share' });
  });

  it.each([
    ['手書きの本文', decl({}), true, { kind: 'check', expr: 'room.open == true' }],
    ['自表の欄だけの条件', decl({}), false, { kind: 'check', expr: 'booking.org_id == booking.org_id' }],
    ['不変条件を名指さない', (({ invariant: _omitted, ...rest }) => rest)(decl({})), false, { kind: 'check', expr: 'room.open == true' }],
  ] as const)('数えない: %s', (_title, trigger, handwritten, formal) => {
    const all = tables(trigger, handwritten);
    expect(impliedLocksOf(trigger, all[0] as DataTableSpec, domain(formal), all)).toEqual({});
  });
});

describe('同じ表の BEFORE トリガの格上げ(点検 D25s-2)', () => {
  const formal: InvariantFormal = { kind: 'check', expr: 'room.open == true' };

  it('発火が重なる別の BEFORE トリガが同じ親を排他で掴むなら、条件のトリガも最初から排他で掴み、格上げは残らない', () => {
    const trigger = decl({});
    const all = tables(trigger, false, [numbering()]);
    expect(impliedLocksOf(trigger, all[0] as DataTableSpec, domain(formal), all)).toEqual({ rooms: 'update' });
    expect(beforeUpgradesOf(all[0] as DataTableSpec, domain(formal), all)).toEqual([]);
  });

  it.each([
    ['発火が重ならない(削除だけで掴む)', numbering({ fires: 'before delete' }), { rooms: 'share' }],
    ['コミット時のトリガ(BEFORE でない)', numbering({ fires: 'after insert (constraint trigger, deferrable initially deferred)', deferred: true }), { rooms: 'share' }],
    ['共有で掴む', numbering({ locks: { rooms: 'share' } }), { rooms: 'share' }],
  ] as const)('上げない: %s', (_title, other, expected) => {
    const trigger = decl({});
    const all = tables(trigger, false, [other]);
    expect(impliedLocksOf(trigger, all[0] as DataTableSpec, domain(formal), all)).toEqual(expected);
  });

  it('手書きの本文どうし(宣言の locks の共有 → 排他)は、名前の順の格上げとして名指す', () => {
    const earlier = decl({ name: 'a_check', functionName: 'a_check', locks: { rooms: 'share' } });
    const all = [dataTable('bookings', { entity: 'booking', triggers: [numbering(), earlier], functions: [{ name: 'a_check', args: [], params: [], kind: 'trigger' as const, alsoWrites: [], handwritten: '理由' }] }), dataTable('rooms', { entity: 'room' })];
    expect(beforeUpgradesOf(all[0] as DataTableSpec, domain(formal), all)).toEqual([{ event: 'insert', parent: 'rooms', earlier: 'a_check', later: 'number_booking' }]);
    // 強く掴む方が名前の順で先なら、後の共有は格上げでない。
    const renamed = [dataTable('bookings', { entity: 'booking', triggers: [numbering({ name: 'a_number', functionName: 'a_number' }), { ...earlier, name: 'z_check', functionName: 'z_check' }] }), dataTable('rooms', { entity: 'room' })];
    expect(beforeUpgradesOf(renamed[0] as DataTableSpec, domain(formal), renamed)).toEqual([]);
  });
});
