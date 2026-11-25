/**
 * ハンドブックの「決めごと」の事実(`semantics/spec-book/invariant-facts.ts`)のテスト。
 *
 * ふれる欄の集め方(裸の欄は自分のエンティティ・now と actor は欄でない)と、種類を構造だけで決めること
 * (お金 = settles の状態へ入る遷移・computes の書き先・computes の関数 / 取り消せない = 終点へ入る遷移 /
 * 見える範囲 = fields_hidden・snapshot の写し先)。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import { invariantFacts } from '../../../../lib/semantics/spec-book/invariant-facts.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { accessSpec, aggregate, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';

const loc = { file: 'x' };
const flow = machine('flow', {
  states: ['open', 'paid', 'done'],
  initial: 'open',
  final: ['done'],
  stateSettles: { paid: ['fee'] },
  settlesVocabulary: { fee: '料金' },
  events: [event('pay', { from: ['open'], to: 'paid', by: ['host'] }), event('finish', { from: ['paid'], to: 'done', by: ['host'] })],
  effects: [{ on: 'finish', do: ['copy'], snapshot: { to: 'mirror', fields: [], location: loc }, location: loc }],
});
const thing = aggregate('thing', {
  entity: entitySpec('thing', { fields: [] }),
  stateMachines: [flow],
  access: { ...accessSpec('thing', {}), fieldsHidden: [{ field: 'secret', from: ['guest'], location: loc }] },
  invariants: invariantSpec([
    invariant({ id: 'I-CHECK', formal: { kind: 'check', expr: 'start < other.end and now >= start and actor.id != thing.owner' } }),
    invariant({ id: 'I-PAY', enforcedBy: [{ kind: 'guard', ref: 'flow.pay', location: loc }] }),
    invariant({ id: 'I-FINAL', enforcedBy: [{ kind: 'guard', ref: 'flow.finish', location: loc }] }),
    invariant({ id: 'I-COMPUTED', formal: { kind: 'uniqueness', keys: ['fee_amount'] } }),
    invariant({ id: 'I-FUNC', enforcedBy: [{ kind: 'application', ref: 'calcFee', location: loc }] }),
    invariant({ id: 'I-HIDDEN', formal: { kind: 'state_dependency', if: 'thing.state == open', then: 'thing.secret != thing.title' } }),
    invariant({ id: 'I-MIRROR', formal: { kind: 'check', expr: 'mirror.title != thing.title' } }),
    invariant({ id: 'I-PROSE', enforcedBy: [{ kind: 'trigger', ref: 'count_rows', location: loc }] }),
  ]),
});
const model = specModel([thing]);
const facts = invariantFacts(model, 'thing', { fields: new Set(['thing.fee_amount']), refs: new Set(['calcFee']) });
const byId = (id: string) => facts.find((fact) => fact.id === id);

describe('invariantFacts', () => {
  it('ふれる欄は式と鍵から集め、裸の欄は自分のエンティティの欄・now と actor は欄でない', () => {
    expect(byId('I-CHECK')?.fields).toEqual(['thing.start', 'other.end', 'thing.owner']);
    expect(byId('I-COMPUTED')?.fields).toEqual(['thing.fee_amount']);
  });

  it('種類は構造だけで決める', () => {
    expect(Object.fromEntries(facts.map((fact) => [fact.id, fact.categories]))).toEqual({
      'I-CHECK': [],
      'I-PAY': ['settle-compute'],
      'I-FINAL': ['into-final'],
      'I-COMPUTED': ['settle-compute'],
      'I-FUNC': ['settle-compute'],
      'I-HIDDEN': ['hidden-snapshot'],
      'I-MIRROR': ['hidden-snapshot'],
      'I-PROSE': [],
    });
  });

  it('形式定義の種類と執行点を持つ(形式定義が無ければ無い)', () => {
    expect(byId('I-CHECK')?.formal).toBe('check');
    expect(byId('I-PROSE')?.formal).toBeUndefined();
    expect(byId('I-PROSE')?.enforcedBy).toEqual([{ kind: 'trigger', ref: 'count_rows' }]);
  });

  it('computes を渡さなければ、computes 由来のお金には当てない', () => {
    expect(invariantFacts(model, 'thing').find((fact) => fact.id === 'I-FUNC')?.categories).toEqual([]);
  });
});
