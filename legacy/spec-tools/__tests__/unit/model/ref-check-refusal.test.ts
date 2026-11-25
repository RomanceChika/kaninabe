/**
 * 参照の欄が指す行を読む条件の**相手の端の断りの文言**(`lib/model/data/ref-check-refusal.ts`。)のユニットテスト。
 *
 * 文言は「{相手の集約の表示名}の{読む欄の表示名}を変えられません。この決まりに合わない{自表の集約の表示名}が N 件あります({言明})」。
 * 表示名は entity_spec の `label`・`fields[].label` で、無ければ内部名に倒す。件数の前後に割って持ち、detail の頭は `{トリガ名}: {ID}: `。
 */

import { describe, expect, it } from 'vitest';
import { counterpartDetailPrefix, counterpartRefusalOf } from '../../../lib/model/data/ref-check-refusal.js';
import { refCounterpartsOf } from '../../../lib/model/data/ref-check-shape.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 題材: 予約は部屋と客を指す。部屋が閉じていれば客は確認済み。`labels` で表示名を付けるか選ぶ。 */
function domain(labels: boolean): SpecModel {
  const label = (text: string) => (labels ? { label: text } : {});
  return specModel(
    [
      aggregate('room', { entity: entitySpec('room', { ...label('部屋'), fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'enum', values: ['open', 'closed'] }, { required: true, ...label('受付の状態') })] }) }),
      aggregate('guest', { entity: entitySpec('guest', { ...label('客'), fields: [field('id', { kind: 'uuid' }, { auto: true }), field('status', { kind: 'enum', values: ['new', 'verified'] }, { required: true, ...label('確認') })] }) }),
      aggregate('booking', {
        entity: entitySpec('booking', {
          ...label('予約'),
          context: { room: 'booking.room_id', guest: 'booking.guest_id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('room_id', { kind: 'ref', entity: 'room' }, { required: true }), field('guest_id', { kind: 'ref', entity: 'guest' }, { required: true })],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOKING-001', entities: ['booking', 'room', 'guest'], statement: '閉じた部屋の予約は確認済みの客だけ', formal: { kind: 'state_dependency', if: 'room.state == closed', then: 'guest.status == verified' } })]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

const trigger: DataTriggerDecl = { name: 'check_booking_guest', functionName: 'check_booking_guest', fires: 'before insert or update of room_id, guest_id', deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-001' };
const tables: readonly DataTableSpec[] = [dataTable('bookings', { entity: 'booking', triggers: [trigger] }), dataTable('rooms', { entity: 'room' }), dataTable('guests', { entity: 'guest' })];

/** その表の相手の端 1 本。 */
function endOf(model: SpecModel, table: string) {
  const found = refCounterpartsOf(tables.find((candidate) => candidate.table === table) as DataTableSpec, model, tables)[0];
  if (found === undefined) throw new Error(table);
  return found;
}

describe('相手の端の断りの文言', () => {
  it('相手の集約と読む欄・自表の集約の表示名と、件数の前後と言明で組む', () => {
    const model = domain(true);
    const refusal = counterpartRefusalOf(endOf(model, 'rooms'));
    expect(`${refusal.before}3${refusal.after}`).toBe('部屋の受付の状態を変えられません。この決まりに合わない予約が 3 件あります(閉じた部屋の予約は確認済みの客だけ)');
    expect(`${counterpartRefusalOf(endOf(model, 'guests')).before}1`).toBe('客の確認を変えられません。この決まりに合わない予約が 1');
    expect(counterpartDetailPrefix(endOf(model, 'rooms'))).toBe('check_booking_guest_on_room: INV-BOOKING-001: ');
  });

  it('表示名が無ければ内部名に倒す(新しい宣言は要らない)', () => {
    const refusal = counterpartRefusalOf(endOf(domain(false), 'rooms'));
    expect(refusal.before).toBe('roomのstateを変えられません。この決まりに合わないbookingが ');
  });
});
