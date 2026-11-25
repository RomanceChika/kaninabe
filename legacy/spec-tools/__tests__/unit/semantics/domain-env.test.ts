/**
 * DomainEnv 構築(V8 / V9 の共通基盤)のテスト。
 * 対象の要求: state → 機械の states、enum → values、boolean → [true,false]、
 * integer → ordered(discrete)、decimal/日時/now → ordered、ref/uuid/文字列 → opaque。
 */

import { describe, expect, it } from 'vitest';
import { buildAggregateEnv, buildDomainEnv } from '../../../lib/semantics/domain-env.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../helpers/model-builder-v8plus.js';

/** entry(全型のフィールド)と workshop(状態機械)を持つモデル。 */
function model() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field('id', { kind: 'uuid' }),
          field('workshop_id', { kind: 'ref', entity: 'workshop' }),
          field('title', { kind: 'string' }),
          field('note', { kind: 'text' }),
          field('duration_min', { kind: 'integer' }),
          field('fee', { kind: 'decimal' }),
          field('submitted_at', { kind: 'datetime' }),
          field('performed_on', { kind: 'date' }),
          field('archived', { kind: 'boolean' }),
          field('kind', { kind: 'enum', values: ['solo', 'duo'] }),
          field('state', { kind: 'state', machine: 'entry' }),
          field('review_state', { kind: 'state', machine: 'unknown_machine' }),
        ]),
        stateMachines: [machine({ machine: 'entry', states: ['draft', 'submitted'] })],
      }),
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [field('state', { kind: 'state', machine: 'workshop' })]),
        stateMachines: [machine({ machine: 'workshop', states: ['accepting', 'closed'] })],
      }),
    ],
  });
}

describe('buildDomainEnv', () => {
  it('state 型は参照先機械の states を全列挙する', () => {
    const env = buildDomainEnv(model());

    expect(env.get('entry.state')).toEqual({ kind: 'finite', values: ['draft', 'submitted'] });
    expect(env.get('workshop.state')).toEqual({ kind: 'finite', values: ['accepting', 'closed'] });
  });

  it('enum は宣言値、boolean は true/false の有限ドメインになる', () => {
    const env = buildDomainEnv(model());

    expect(env.get('entry.kind')).toEqual({ kind: 'finite', values: ['solo', 'duo'] });
    expect(env.get('entry.archived')).toEqual({ kind: 'finite', values: ['true', 'false'] });
  });

  it('integer は離散(discrete)な ordered になる', () => {
    expect(buildDomainEnv(model()).get('entry.duration_min')).toEqual({ kind: 'ordered', discrete: true });
  });

  it('decimal・日付・now は連続扱いの ordered になる', () => {
    const env = buildDomainEnv(model());

    expect(env.get('entry.fee')).toEqual({ kind: 'ordered' });
    expect(env.get('entry.submitted_at')).toEqual({ kind: 'ordered' });
    expect(env.get('entry.performed_on')).toEqual({ kind: 'ordered' });
    expect(env.get('now')).toEqual({ kind: 'ordered' });
  });

  it('uuid / ref / 文字列と actor.id は opaque になる', () => {
    const env = buildDomainEnv(model());

    expect(env.get('entry.id')).toEqual({ kind: 'opaque' });
    expect(env.get('entry.workshop_id')).toEqual({ kind: 'opaque' });
    expect(env.get('entry.title')).toEqual({ kind: 'opaque' });
    expect(env.get('entry.note')).toEqual({ kind: 'opaque' });
    expect(env.get('actor.id')).toEqual({ kind: 'opaque' });
  });

  it('未定義の状態機械を参照する state 型は opaque へフォールバックする(境界)', () => {
    expect(buildDomainEnv(model()).get('entry.review_state')).toEqual({ kind: 'opaque' });
  });

  it('entity_spec を持たない集約は環境に何も足さない(境界)', () => {
    const env = buildDomainEnv(specModel({ aggregates: [aggregate({ name: 'entry' })] }));

    expect([...env.keys()].sort()).toEqual(['actor.id', 'now']);
  });
});

describe('buildAggregateEnv', () => {
  it('自集約のフィールドは裸の名前でも引ける', () => {
    const env = buildAggregateEnv(model(), 'entry');

    expect(env.get('state')).toEqual({ kind: 'finite', values: ['draft', 'submitted'] });
    expect(env.get('kind')).toEqual({ kind: 'finite', values: ['solo', 'duo'] });
    expect(env.get('workshop.state')).toEqual({ kind: 'finite', values: ['accepting', 'closed'] });
  });

  it('存在しない集約名を渡してもモデル全体の環境を返す(境界)', () => {
    const env = buildAggregateEnv(model(), 'missing');

    expect(env.get('entry.state')).toEqual({ kind: 'finite', values: ['draft', 'submitted'] });
    expect(env.has('state')).toBe(false);
  });
});
