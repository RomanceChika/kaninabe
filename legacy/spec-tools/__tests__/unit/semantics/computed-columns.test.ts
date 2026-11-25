/**
 * 計算で決まる列の引き当て(`transitionComputedColumns`)の単体テスト。
 *
 * 対象の要求(action-spec-writing.md §computes / domain-spec-writing.md §transition_writes):
 * 計算で決まる値は `writes` に行を持たないので、「遷移が書く列」であることは `computes` の宣言から導く。
 * 数えるのは**遷移**の `computes` だけで(別の集約の遷移も含む)、編集・作成の `computes` は数えない。
 */

import { describe, expect, it } from 'vitest';
import { transitionComputedColumns } from '../../../lib/semantics/computed-columns.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, specModel, writeRule } from '../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 料金を確定する遷移を持つ show と、額を持つ seat(seat には編集の規則が 1 本ある)。 */
const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'show',
      entity: entitySpec('show', [field('state', { kind: 'state', machine: 'show' }, { required: true }), field('total', { kind: 'integer' })]),
      stateMachines: [
        machine({
          machine: 'show',
          states: ['open', 'fixed'],
          initial: 'open',
          events: [event({ id: 'fix', from: ['open'], to: 'fixed', by: ['staff'] })],
        }),
      ],
    }),
    aggregate({
      name: 'seat',
      entity: entitySpec('seat', [field('fee', { kind: 'integer' }), field('mark', { kind: 'boolean' }), field('label', { kind: 'string' })]),
      access: accessSpec('seat', { writes: [writeRule('staff', ['label'])] }),
    }),
  ],
});

const ACTIONS = [
  actionSpec({ handles: 'show.fix', computes: { 'show.total': 'showTotal', 'seat.fee': 'seatFee' } }),
  actionSpec({ handles: 'seat.update', input: ['seat.label'], computes: { 'seat.mark': 'seatMark' } }),
];

describe('transitionComputedColumns', () => {
  it('自分の集約の遷移が計算して書く列を返す', () => {
    expect(transitionComputedColumns(MODEL, ACTIONS, 'show')).toEqual(['total']);
  });

  it('別の集約の遷移が計算して書く列も返し、編集の computes は数えない', () => {
    expect(transitionComputedColumns(MODEL, ACTIONS, 'seat')).toEqual(['fee']);
  });

  it('action_spec が無ければ空(書く宣言が無いものは遷移が書く列にしない)', () => {
    expect(transitionComputedColumns(MODEL, [], 'seat')).toEqual([]);
  });
});
