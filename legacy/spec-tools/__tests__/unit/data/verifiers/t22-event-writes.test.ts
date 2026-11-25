/**
 * T22(複数のイベントが通る RPC の破壊的な書き込みは、イベントごとに宣言する = event_writes)のテスト。
 *
 * 題材は架空のメンバー(退会だけが後始末で予約を消す。休会は何も消さない。同じ遷移の RPC を両方が通る)。
 */

import { describe, expect, it } from 'vitest';
import { verifyEventWrites } from '../../../../lib/data/verifiers/t22-event-writes.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';

const DOMAIN = specModel([
  aggregate('member', {
    entity: entitySpec('member', { fields: [] }),
    stateMachines: [
      machine('membership', {
        states: ['active', 'paused', 'left'],
        initial: 'active',
        final: ['left'],
        events: [event('pause', { from: ['active'], to: 'paused', by: ['staff'] }), event('leave', { from: ['active', 'paused'], to: 'left', by: ['staff'] })],
      }),
    ],
  }),
  aggregate('booking', { entity: entitySpec('booking', { fields: [] }) }),
  aggregate('public_booking', { entity: { ...entitySpec('public_booking', { fields: [] }), mirror: true } }),
]);

/** メンバーの遷移の RPC(命名規約どおり)。 */
function transition(extra: Partial<DataFunctionDecl>): DataFunctionDecl {
  return {
    name: 'apply_member_transition',
    args: [],
    params: [],
    kind: 'rpc',
    shape: 'transition',
    handwritten: '後始末を本文が持つ',
    alsoWrites: ['bookings', 'domain_events'],
    alsoWriteKinds: { bookings: ['delete'], domain_events: ['insert'] },
    ...extra,
  };
}

function messages(fn: DataFunctionDecl, jobs = jobModel([outboxJob('notify_left')])): readonly string[] {
  const tables = dataTableModel([dataTable('members', { entity: 'member', functions: [fn] }), dataTable('bookings', { entity: 'booking' })]);
  return verifyEventWrites(DOMAIN, tables, jobs).map((finding) => finding.message);
}

const BOTH = { 'membership.pause': { domain_events: ['insert'] }, 'membership.leave': { bookings: ['delete'], domain_events: ['insert'] } } as const;

describe('T22 event_writes', () => {
  it.each([
    { name: '写しの表に添える内部テーブルの削除は数えない', mirrorOf: 'public_bookings', red: false },
    { name: '写しでない表を名指した添え表は数える(閉じる側)', mirrorOf: 'bookings', red: true },
    { name: '宣言が無い内部テーブルは数える', mirrorOf: undefined, red: true },
  ])('mirror_of: $name', ({ mirrorOf, red }) => {
    const fn = transition({ alsoWrites: ['public_booking_keys'], alsoWriteKinds: { public_booking_keys: ['delete'] } });
    const tables = dataTableModel([dataTable('members', { entity: 'member', functions: [fn] }), dataTable('public_booking_keys', { internal: true, ...(mirrorOf === undefined ? {} : { mirrorOf }) })]);
    expect(verifyEventWrites(DOMAIN, tables, jobModel([outboxJob('notify_left')]))).toHaveLength(red ? 1 : 0);
  });

  it('破壊的な書き込みを持つ遷移の RPC に event_writes が無ければ error', () => {
    const result = messages(transition({}));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('event_writes がありません');
    expect(result[0]).toContain('membership.pause, membership.leave');
  });

  it('全イベントについて also_writes の部分集合を宣言していれば指摘は無い', () => {
    expect(messages(transition({ eventWrites: BOTH }))).toEqual([]);
  });

  it('足りないイベント・通らないイベント・also_writes に無い書き込み・どのイベントも行わない書き込みを名指す', () => {
    expect(messages(transition({ eventWrites: { 'membership.leave': BOTH['membership.leave'] } }))).toEqual([
      expect.stringContaining('membership.pause が通りますが、event_writes に membership.pause がありません'),
    ]);
    expect(messages(transition({ eventWrites: { ...BOTH, 'membership.erase': {} } }))).toEqual([expect.stringContaining('membership.erase は、この RPC を通るイベントではありません')]);
    expect(messages(transition({ eventWrites: { ...BOTH, 'membership.pause': { members: ['update'] } } }))).toEqual([
      expect.stringContaining('members に update を宣言していますが、also_writes にありません'),
    ]);
    expect(messages(transition({ eventWrites: { 'membership.pause': {}, 'membership.leave': {} } }))).toEqual([
      expect.stringContaining('bookings: [delete] を、event_writes のどのイベントも行いません'),
      expect.stringContaining('domain_events: [insert] を、event_writes のどのイベントも行いません'),
    ]);
  });

  it('写しの表の削除だけなら要求しない・1 つのイベントしか通らない RPC にも要求しない', () => {
    expect(messages(transition({ alsoWrites: ['public_bookings'], alsoWriteKinds: { public_bookings: ['delete'] } }))).toEqual([]);
    const single: DataFunctionDecl = { ...transition({}), name: 'close_member', shape: 'composite', selfWriteKinds: [] };
    expect(messages(single)).toEqual([]);
  });

  it('realized_by で名指すイベントも通るイベントに数える', () => {
    const composite: DataFunctionDecl = { ...transition({}), name: 'close_member', shape: 'composite', selfWriteKinds: [] };
    const jobs = jobModel([
      outboxJob('end', { kind: 'transaction_effect', inTransaction: true, realizedBy: { 'membership.pause': 'close_member', 'membership.leave': 'close_member' } }),
    ]);
    expect(messages(composite, jobs)).toEqual([expect.stringContaining('event_writes がありません')]);
  });

  it('自表の破壊的な書き込みは複数のイベントが通る RPC では持てない', () => {
    const result = messages(transition({ eventWrites: BOTH, selfWriteKinds: ['update', 'scrub'] }));
    expect(result).toEqual([expect.stringContaining('帰属表 members に破壊的な書き込み')]);
  });

  it('data_table を採らない構成は何も言わない', () => {
    expect(verifyEventWrites(DOMAIN, { available: false, tables: [] }, undefined)).toEqual([]);
  });
});
