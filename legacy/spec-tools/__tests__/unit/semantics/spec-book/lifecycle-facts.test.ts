/**
 * ハンドブックの「流れ」の節の事実(`semantics/spec-book/lifecycle-facts.ts`)のテスト。
 *
 * 状態の区分(否定的が終点より先・終点の真偽は別に持つ)・確定するものの表示名・どこからでもの遷移・
 * 自動の判定が遷移の事実に 1 度だけ載ること。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import { collectEventOrigins } from '../../../../lib/semantics/spec-book/event-origins.js';
import { allLifecycleFacts, lifecycleFacts } from '../../../../lib/semantics/spec-book/lifecycle-facts.js';
import { scheduledJob } from '../../../helpers/job-builder.js';
import { aggregate, event, machine, roleSpec, specModel } from '../../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['draft', 'open', 'settled', 'done', 'dropped', 'held'],
  initial: 'draft',
  final: ['done', 'dropped'],
  stateLabels: { draft: '下書き', open: '受付中', settled: '確定', done: '終了', dropped: '中止' },
  stateTone: { dropped: 'negative', held: 'negative' },
  stateSettles: { settled: ['fee'] },
  settlesVocabulary: { fee: '料金' },
  stateSummaries: { open: '申し込みを受け付ける' },
  events: [
    event('publish', { from: ['draft'], to: 'open', by: ['host'], label: '公開する' }),
    event('settle', { from: ['open'], to: 'settled', by: ['system'] }),
    event('finish', { from: ['settled'], to: 'done', by: ['system'] }),
    event('drop', { from: ['draft', 'open', 'settled', 'held'], to: 'dropped', by: ['host'] }),
    event('hold', { from: ['open'], to: 'held', by: ['host'] }),
  ],
});
const model = specModel([aggregate('thing', { stateMachines: [flow] })], roleSpec(['system', 'host']));
const origins = collectEventOrigins(model, { jobs: [scheduledJob('settle_due', { fires: 'flow.settle' })], auth: null, integrations: [], unread: [] });
const facts = lifecycleFacts(model, 'thing', flow, origins);

describe('lifecycleFacts', () => {
  it('状態の区分は仕様の欄だけで決まる(否定的が終点より先・途中の否定的もある)', () => {
    expect(facts.states.map((state) => [state.id, state.category, state.final])).toEqual([
      ['draft', 'start', false],
      ['open', 'progress', false],
      ['settled', 'progress', false],
      ['done', 'done', true],
      ['dropped', 'negative', true],
      ['held', 'negative', false],
    ]);
  });

  it('表示名・確定するもの(語彙の表示名)・段の場面を持つ。表示名が無ければ id', () => {
    expect(facts.states.find((state) => state.id === 'settled')?.settles).toEqual(['料金']);
    expect(facts.states.find((state) => state.id === 'open')?.summary).toBe('申し込みを受け付ける');
    expect(facts.states.find((state) => state.id === 'held')?.label).toBe('held');
  });

  it('本筋の段の番号は、否定的な状態を通らずに届く状態に始まりからの手数の順で付く(否定的な状態には付かない)', () => {
    expect(facts.steps).toBe(4);
    expect(facts.states.map((state) => [state.id, state.step])).toEqual([
      ['draft', 1],
      ['open', 2],
      ['settled', 3],
      ['done', 4],
      ['dropped', undefined],
      ['held', undefined],
    ]);
  });

  it('始まりが否定的な状態なら、本筋の番号を 1 つも付けない', () => {
    const odd = machine('odd', {
      states: ['void', 'next'],
      initial: 'void',
      stateTone: { void: 'negative' },
      events: [event('go', { from: ['void'], to: 'next', by: ['host'] })],
    });
    const oddFacts = lifecycleFacts(specModel([aggregate('odd', { stateMachines: [odd] })], roleSpec(['host'])), 'odd', odd, origins);
    expect(oddFacts.steps).toBe(0);
    expect(oddFacts.states.map((state) => state.step)).toEqual([undefined, undefined]);
  });

  it('自動の判定を遷移の事実に持つ(発火元のある system の遷移 = auto-only・無い = system-unwired・人の遷移 = manual)', () => {
    expect(Object.fromEntries(facts.transitions.map((transition) => [transition.id, transition.autonomy]))).toEqual({
      publish: 'manual',
      settle: 'auto-only',
      finish: 'system-unwired',
      drop: 'manual',
      hold: 'manual',
    });
    expect(facts.transitions.find((transition) => transition.id === 'settle')?.origins).toEqual([
      { kind: 'job', id: 'settle_due', scheduled: true },
    ]);
  });

  it('自動と言えない system の遷移にだけ unscanned の理由を添える', () => {
    const reasons = new Map([
      ['flow.finish', '別の遷移が一括で起こす'],
      ['flow.settle', '使われない理由'],
    ]);
    const withReasons = lifecycleFacts(model, 'thing', flow, origins, reasons);
    expect(withReasons.transitions.find((transition) => transition.id === 'finish')?.unwiredReason).toBe('別の遷移が一括で起こす');
    expect(withReasons.transitions.find((transition) => transition.id === 'settle')?.unwiredReason).toBeUndefined();
  });

  it('終点以外の全状態から出る遷移だけを「どこからでも」とする', () => {
    expect(facts.transitions.filter((transition) => transition.fromAnywhere).map((transition) => transition.id)).toEqual(['drop']);
  });

  it('製品の全状態機械を集約の宣言順に並べる', () => {
    const second = machine('other', { states: ['a', 'b'], initial: 'a', events: [event('go', { from: ['a'], to: 'b', by: ['host'] })] });
    const both = specModel([aggregate('thing', { stateMachines: [flow] }), aggregate('next', { stateMachines: [second] })], roleSpec(['system', 'host']));
    expect(allLifecycleFacts(both, origins).map((fact) => `${fact.aggregate}/${fact.machine}`)).toEqual(['thing/flow', 'next/other']);
  });
});
