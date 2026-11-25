/**
 * T14(1 欄ずつ受ける引数の宣言型 == 列の型)のテスト。
 *
 * 固定するのは 4 つ:
 *   - 列の型と同じなら何も言わない
 *   - 違えば error(`text` の引数を `timestamptz` の列へ。fixture `rooms` の実測)
 *   - 意味が固定されている引数(`p_id` / `p_actor_id` / `p_values`)は見ない
 *   - `shape: composite` と `kind: trigger` / `helper` は見ない(定型の本文が無い)
 */

import { describe, expect, it } from 'vitest';
import { verifyRpcArgTypes } from '../../../../lib/data/verifiers/t14-rpc-arg-types.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { accessSpec, aggregate, create, entitySpec, field, machine, event, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 題材: 予約(booking)。開始時刻は datetime = timestamptz の列である。 */
function domain(): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        context: { booking: 'booking.id', room: 'booking.room_id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }),
          field('title', { kind: 'string' }),
          field('starts_at', { kind: 'datetime' }, { required: true }),
        ],
      }),
      access: accessSpec('booking', { creates: [create('member')] }),
      stateMachines: [
        machine('booking', {
          states: ['held', 'done'],
          initial: 'held',
          events: [event('finish', { from: ['held'], to: 'done', by: ['member'] })],
        }),
      ],
    }),
    aggregate('room', {
      entity: entitySpec('room', {
        context: { room: 'room.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true })],
      }),
    }),
  ]);
}

/** 作成 RPC 1 本(`p_starts_at` の宣言型と形だけを動かす)。 */
function insertBooking(startsAtType: string, shape: DataFunctionDecl['shape'] = 'create'): DataFunctionDecl {
  return {
    name: 'insert_booking',
    args: ['uuid', 'uuid', 'text', startsAtType, 'uuid', 'text[]'],
    params: ['p_id', 'p_room_id', 'p_title', 'p_starts_at', 'p_actor_id', 'p_actor_roles'],
    kind: 'rpc',
    ...(shape === undefined ? {} : { shape }),
    migration: '20260101000001_rpc_insert_booking.sql',
    alsoWrites: [],
  };
}

/** その関数 1 本を持つモデル。 */
function model(fn: DataFunctionDecl) {
  return dataTableModel([
    dataTable('bookings', { entity: 'booking', functions: [fn] }),
    dataTable('rooms', { entity: 'room' }),
  ]);
}

describe('T14 1 欄ずつ受ける引数の型', () => {
  it('列の型と同じなら何も言わない', () => {
    expect(verifyRpcArgTypes(domain(), model(insertBooking('timestamptz')))).toEqual([]);
  });

  it('列の型と違えば error(text の引数を timestamptz の列へ)', () => {
    const findings = verifyRpcArgTypes(domain(), model(insertBooking('text')));
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T14', 'error']]);
    expect(findings[0]?.message).toContain('p_starts_at');
    expect(findings[0]?.counterexample).toMatchObject({ declared: 'text', expected: 'timestamptz' });
  });

  it('意味が固定されている引数は見ない(p_id / p_actor_id / p_actor_roles)', () => {
    // 3 本とも宣言どおりの型のままで、動かしたのは `p_starts_at` だけである。
    const findings = verifyRpcArgTypes(domain(), model(insertBooking('text')));
    expect(findings.every((finding) => finding.counterexample?.param === 'p_starts_at')).toBe(true);
  });

  it('shape: composite は定型の本文を持たないので見ない', () => {
    expect(verifyRpcArgTypes(domain(), model(insertBooking('text', 'composite')))).toEqual([]);
  });

  it('kind: trigger は見ない', () => {
    const trigger: DataFunctionDecl = { name: 'sync', args: [], params: [], kind: 'trigger', alsoWrites: [] };
    expect(verifyRpcArgTypes(domain(), model(trigger))).toEqual([]);
  });
});
