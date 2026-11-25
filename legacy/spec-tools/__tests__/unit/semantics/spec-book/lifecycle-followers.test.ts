/**
 * ハンドブックの「軸にする流れ」の判定(`semantics/spec-book/lifecycle-followers.ts`)のテスト。
 *
 * 世界は小さく作る: 親(状態機械 flow: open → closed → done)と、親の状態を条件にする子の遷移・作成・書き込み・読み取り、
 * 状態にふれない規則。軸は従う集約の数で決まり、0 なら軸なし・同数なら複数。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import { lifecycleAxes, machineFollowers } from '../../../../lib/semantics/spec-book/lifecycle-followers.js';
import {
  accessSpec,
  aggregate,
  create,
  entitySpec,
  event,
  field,
  machine,
  read,
  specModel,
  write,
} from '../../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['open', 'closed', 'done'],
  initial: 'open',
  final: ['done'],
  events: [event('close', { from: ['open'], to: 'closed', by: ['host'] })],
});
const parent = aggregate('thing', {
  entity: entitySpec('thing', { fields: [field('state', { kind: 'state', machine: 'flow' })] }),
  stateMachines: [flow],
});
const child = aggregate('part', {
  entity: entitySpec('part', { fields: [field('thing_id', { kind: 'ref', entity: 'thing' }), field('state', { kind: 'state', machine: 'part_flow' })] }),
  stateMachines: [
    machine('part_flow', {
      states: ['x', 'y'],
      initial: 'x',
      events: [
        event('move', { from: ['x'], to: 'y', by: ['guest'], guard: 'thing.state != done', label: '動かす' }),
        event('free', { from: ['x'], to: 'y', by: ['guest'] }),
      ],
    }),
  ],
  access: accessSpec('part', {
    creates: [create('guest', "thing.state == open")],
    writes: [write('guest', ['note'], 'thing.state in [open, closed] and now >= thing.state_at'), write('guest', ['memo'])],
    reads: [read('guest', 'all', undefined, 'thing.state == done')],
  }),
});
const loner = aggregate('note', { entity: entitySpec('note', { fields: [field('body', { kind: 'string' })] }) });

describe('machineFollowers', () => {
  const model = specModel([parent, child, loner]);
  const result = machineFollowers(model, parent, flow);

  it('ほかの集約の遷移・作成・書き込み・読み取りのうち、持ち主の状態にふれるものだけを、開く状態つきで集める', () => {
    expect(result.rules.map((rule) => [rule.kind, rule.event, rule.states])).toEqual([
      ['event', 'part_flow.move', ['open', 'closed']],
      ['create', '', ['open']],
      ['write', '', ['open', 'closed']],
      ['read', '', ['done']],
    ]);
    expect(result.rules[0]?.label).toBe('動かす');
  });

  it('従う集約は宣言順に重複なく', () => {
    expect(result.followers).toEqual(['part']);
  });
});

describe('lifecycleAxes', () => {
  it('従う集約がいちばん多い状態機械を軸にする', () => {
    expect(lifecycleAxes(specModel([parent, child, loner])).axes.map((axis) => axis.machine)).toEqual(['flow']);
  });

  it('どの状態機械にも従う集約が無ければ軸なし', () => {
    const plain = aggregate('part', { entity: entitySpec('part', { fields: [field('thing_id', { kind: 'ref', entity: 'thing' })] }) });
    const result = lifecycleAxes(specModel([parent, plain]));
    expect(result.axes).toEqual([]);
    expect(result.all.map((entry) => [entry.machine, entry.followers.length])).toEqual([['flow', 0]]);
  });

  it('同数なら全部を軸にする(1 つに寄せない)', () => {
    const other = machine('other', { states: ['p', 'q'], initial: 'p', events: [] });
    const second = aggregate('other', {
      entity: entitySpec('other', { fields: [field('state', { kind: 'state', machine: 'other' })] }),
      stateMachines: [other],
    });
    const reader = aggregate('reader', {
      entity: entitySpec('reader', { fields: [field('body', { kind: 'string' })] }),
      access: accessSpec('reader', { creates: [create('guest', 'other.state == p')] }),
    });
    expect(lifecycleAxes(specModel([parent, child, second, reader])).axes.map((axis) => axis.machine)).toEqual(['flow', 'other']);
  });
});
