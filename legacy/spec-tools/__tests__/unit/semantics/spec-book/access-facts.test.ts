/**
 * ハンドブックの「できること」「見える範囲」と役の凡例の事実(`semantics/spec-book/access-facts.ts`)のテスト。
 *
 * 役の種類の区分・宣言した操作の数(含意で受け継ぐ分は数えない・1 つの遷移に 2 度書いても 1)・操作の並びと理由つきの受け入れ・
 * 役ごとに隠す欄。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import { aggregateAccessFacts, roleFacts } from '../../../../lib/semantics/spec-book/access-facts.js';
import { accessSpec, aggregate, create, del, event, machine, read, role, roleSpec, specModel, write } from '../../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['open', 'closed'],
  initial: 'open',
  events: [
    event('close', { from: ['open'], to: 'closed', by: ['host', 'system', 'host'], guard: 'now >= thing.due', label: '閉じる' }),
    { ...event('claim', { from: ['open'], to: 'open', by: ['member'] }), selfAssign: [{ entity: 'thing', field: 'host_id', role: 'host', by: ['member'], reason: '自分を担当にする', location: { file: 'x', pointer: 'self_assign[0]' } }] },
  ],
});
const access = {
  ...accessSpec('thing', {
    creates: [{ ...create('member'), delegate: [{ entity: 'thing', field: 'host_id', reason: 'host', location: { file: 'x', pointer: 'creates[0].delegate[0]' } }] }],
    writes: [write('host', ['title', 'note'], 'thing.state == open')],
    deletes: [{ ...del('anonymous'), public: '誰でも消せる掲示' }],
    reads: [read('member', 'all'), read('host', 'own', undefined, 'thing.state == open')],
  }),
  fieldsHidden: [{ field: 'secret', from: ['member'], location: { file: 'x', pointer: 'fields_hidden.secret' } }],
};
const roles = roleSpec(['anonymous', 'member', 'system', role('host', 'thing.host_id == actor.id', ['member']), role('helper', undefined, ['member'])]);
const model = specModel([aggregate('thing', { stateMachines: [flow], access })], roles);

describe('aggregateAccessFacts', () => {
  const facts = aggregateAccessFacts(model, 'thing');

  it('遷移 → 作成 → 編集 → 削除の順に、誰が・どの欄を・どの条件でを持つ', () => {
    expect(facts.operations.map((operation) => [operation.kind, operation.event, operation.by, operation.fields, operation.when])).toEqual([
      ['event', 'flow.close', ['host', 'system', 'host'], [], 'now >= thing.due'],
      ['event', 'flow.claim', ['member'], [], undefined],
      ['create', '', ['member'], [], undefined],
      ['write', '', ['host'], ['title', 'note'], 'thing.state == open'],
      ['delete', '', ['anonymous'], [], undefined],
    ]);
  });

  it('理由つきの受け入れ(self_assign・作成の代行・public)を持つ', () => {
    expect(facts.operations.map((operation) => operation.accepted.map((entry) => entry.kind))).toEqual([[], ['self_assign'], ['delegate'], [], ['public']]);
  });

  it('self_assign は名指した欄 × 役 × 書き手つきの文で読者に見せる(受け入れは欄・書き手ごとに効く)', () => {
    expect(facts.operations[1]?.accepted).toEqual([{ kind: 'self_assign', text: 'thing.host_id(host)・by member: 自分を担当にする' }]);
  });

  it('読み取りは範囲と条件を持ち、その役から隠す欄を引く', () => {
    expect(facts.reads.map((rule) => [rule.by, rule.scope.kind, rule.when, rule.hiddenFields])).toEqual([
      ['member', 'all', undefined, ['secret']],
      ['host', 'own', 'thing.state == open', []],
    ]);
  });

  it('集約が無ければ空', () => {
    expect(aggregateAccessFacts(model, 'nowhere')).toEqual({ aggregate: 'nowhere', operations: [], reads: [] });
  });
});

describe('roleFacts', () => {
  it('種類は kind と binding から決め、操作の数は役の名前で宣言した分だけ(含意で受け継ぐ分・同じ遷移の重複は数えない)', () => {
    expect(roleFacts(model).map((fact) => [fact.id, fact.roleClass, fact.declaredOperations])).toEqual([
      ['anonymous', 'anonymous', 1],
      ['member', 'global', 2],
      ['system', 'system', 1],
      ['host', 'relation', 2],
      ['helper', 'global', 0],
    ]);
    expect(roleFacts(model).find((fact) => fact.id === 'host')?.implies).toEqual(['member']);
  });
});
