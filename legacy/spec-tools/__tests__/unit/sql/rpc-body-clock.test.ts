/**
 * 定型 RPC の本文の**時刻の取り方**のユニットテスト(`rpc-body-lock.ts` の `clockCapture` / `rpc-parts.ts` の `CLOCK_VAR`)。
 *
 * 時刻のガード(予約語 `now`)と `records_time` は、トランザクション開始時刻の `now()` ではなく、
 * **行ロックを取った後に 1 度だけ取る `clock_timestamp()`**(`v_now`)を使う —— ロック待ちが締切をまたぐと
 * `now()` は期限切れの後に通る。見るのは 4 つ:
 *   - 遷移: 宣言(`declare`)・取得(ロックの直後・更新の前)・ガードの `now`・`records_time` の全部が同じ `v_now`
 *   - **時刻を使わない RPC の本文は 1 バイトも変わらない**(`v_now` も `clock_timestamp` も出ない)
 *   - 編集・削除・作成も、ガードが `now` を読むなら同じ形(宣言と取得がロックの後)
 *   - 変異: `now()` が本文のどこにも残らない
 */

import { describe, expect, it } from 'vitest';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, event, field, machine, specModel, write } from '../../helpers/model-builder.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 時刻のガード付きの `finish`(`now < booking.ends_at`)と `records_time: [finished_at]` を持つ予約。 */
function domain(guardOnWrite: string | null): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        label: '予約',
        context: { booking: 'booking.id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'booking' }),
          field('purpose', { kind: 'string' }),
          field('ends_at', { kind: 'datetime' }),
          field('finished_at', { kind: 'datetime' }),
        ],
      }),
      access: accessSpec('booking', {
        writes: [write('member', ['purpose'], guardOnWrite ?? undefined)],
        creates: [create('member')],
        transitionWrites: ['finished_at'],
      }),
      stateMachines: [
        machine('booking', {
          states: ['held', 'done', 'cancelled'],
          initial: 'held',
          events: [
            event('finish', { from: ['held'], to: 'done', by: ['member'], guard: 'now < booking.ends_at', recordsTime: ['finished_at'] }),
            event('cancel', { from: ['held'], to: 'cancelled', by: ['member'] }),
          ],
        }),
      ],
    }),
  ]);
}

const TRANSITION_PARAMS = ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'];
const TRANSITION_ARGS = ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'];

function build(shape: 'create' | 'update' | 'delete' | 'transition', params: readonly string[], args: readonly string[], model: SpecModel): string {
  const result = buildRpcBody({
    name: shape === 'transition' ? 'apply_booking_transition' : `${shape}_booking`,
    params,
    args,
    shape,
    table: dataTable('bookings', { entity: 'booking' }),
    domain: model,
    tableOf: (entity) => (entity === 'booking' ? 'bookings' : null),
    actions: undefined,
    specFiles: [],
    entityLabel: '予約',
    platform: TEST_PLATFORM,
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
}

/** コメント行(説明に now() の語が出る)を除いた SQL。 */
function code(sql: string): string {
  return sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
}

describe('時刻の取り方(行ロックの後の 1 つの時刻)', () => {
  const sql = build('transition', TRANSITION_PARAMS, TRANSITION_ARGS, domain(null));

  it('遷移: 宣言し、行ロックの直後・更新の前に clock_timestamp() を 1 度だけ取る', () => {
    expect(sql).toContain('    v_now timestamptz;');
    expect(sql.match(/v_now := clock_timestamp\(\);/g)).toHaveLength(1);
    expect(sql.indexOf('for update of t;')).toBeLessThan(sql.indexOf('v_now := clock_timestamp();'));
    expect(sql.indexOf('v_now := clock_timestamp();')).toBeLessThan(sql.indexOf('update public.bookings t'));
  });

  it('遷移: ガードの now と records_time は同じ v_now を使い、now() は本文のどこにも残らない', () => {
    expect(sql).toContain('(v_now < (t.ends_at))');
    expect(sql).toContain("finished_at = case when p_event_id in ('booking.finish') then v_now else t.finished_at end");
    expect(code(sql)).not.toContain('now()');
  });

  it('時刻を使わない遷移の本文には v_now も clock_timestamp も出ない(字面が変わらない)', () => {
    const plain = specModel([
      aggregate('booking', {
        entity: entitySpec('booking', {
          label: '予約',
          context: { booking: 'booking.id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'booking' })],
        }),
        access: accessSpec('booking', {}),
        stateMachines: [
          machine('booking', {
            states: ['held', 'done'],
            initial: 'held',
            events: [event('finish', { from: ['held'], to: 'done', by: ['member'] })],
          }),
        ],
      }),
    ]);
    const body = build('transition', TRANSITION_PARAMS, TRANSITION_ARGS, plain);
    expect(body).not.toContain('v_now');
    expect(body).not.toContain('clock_timestamp');
  });

  it('編集: 時刻を使わない編集の本文にも v_now は出ない', () => {
    const body = build('update', ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'], ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]'], domain(null));
    expect(body).not.toContain('v_now');
  });

  it('編集: 書き込みの規則のガードが now を読むなら、ロックの後に時刻を取って同じ変数で判定する', () => {
    const body = build(
      'update',
      ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'],
      ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]'],
      domain('now < booking.ends_at'),
    );
    expect(body).toContain('    v_now timestamptz;');
    expect(body).toContain('(v_now < (t.ends_at))');
    expect(code(body)).not.toContain('now()');
    expect(body.indexOf('for update of t;')).toBeLessThan(body.indexOf('v_now := clock_timestamp();'));
    expect(body.indexOf('v_now := clock_timestamp();')).toBeLessThan(body.indexOf('update public.bookings t'));
  });
});
