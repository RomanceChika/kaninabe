/**
 * V8(決定性)の規約網羅テスト。
 * 対象の要求: 同一(状態, イベント, ロール)でガードが同時成立し、行き先が異なる遷移がないこと。
 */

import { describe, expect, it } from 'vitest';
import { determinismVerifier } from '../../../../lib/verify/verifiers/v8-determinism.js';
import {
  NO_GUARD_KEY,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';

/** 同一イベント ID の 2 定義を持つ entry 機械。デフォルトで from とロールが重なる。 */
function entryModel(init: { guardA?: string; guardB?: string; toB?: string; byB?: readonly string[] } = {}) {
  const eventA = event({
    id: 'review',
    from: ['submitted'],
    to: 'accepted',
    by: ['organizer'],
    ...(init.guardA === undefined ? {} : { guard: init.guardA }),
    pointer: 'events.review[0]',
  });
  const eventB = event({
    id: 'review',
    from: ['submitted', 'draft'],
    to: init.toB ?? 'rejected',
    by: init.byB ?? ['organizer', 'system'],
    ...(init.guardB === undefined ? {} : { guard: init.guardB }),
    pointer: 'events.review[1]',
  });
  return specModel({
    roles: [role('organizer'), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted', 'accepted', 'rejected'],
            initial: 'draft',
            events: [eventA, eventB],
          }),
        ],
      }),
    ],
  });
}

describe('determinismVerifier', () => {
  it('ガードが同時成立し行き先が異なる 2 定義をエラーにする', () => {
    const model = entryModel({ guardA: 'score >= 5', guardB: 'score >= 3' });
    const { ctx } = stubContext({ coexist: { 'score >= 5|score >= 3': true } });

    const findings = determinismVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.verifier).toBe('V8');
    expect(finding?.severity).toBe('error');
    expect(finding?.counterexample).toMatchObject({
      machine: 'entry',
      event: 'review',
      state: 'submitted',
      role: 'organizer',
      to_a: 'accepted',
      to_b: 'rejected',
      guard_a: 'score >= 5',
      guard_b: 'score >= 3',
    });
  });

  it('canCoexist の witness(変数割当)を反例に載せる', () => {
    const model = entryModel({ guardA: 'workshop.state == accepting', guardB: 'workshop.state != closed' });
    const { ctx } = stubContext({
      coexist: {
        'workshop.state == accepting|workshop.state != closed': {
          coexists: true,
          witness: { 'workshop.state': 'accepting' },
        },
      },
    });

    const [finding] = determinismVerifier.verify(model, ctx);

    expect(finding?.counterexample).toMatchObject({
      state: 'submitted',
      'workshop.state': 'accepting',
    });
  });

  it('witness のキーが固定キーと衝突したら witness. を前置して両方残す', () => {
    const model = entryModel({ guardA: 'state == submitted', guardB: 'state != draft' });
    const { ctx } = stubContext({
      coexist: {
        'state == submitted|state != draft': { coexists: true, witness: { state: 'draft' } },
      },
    });

    const [finding] = determinismVerifier.verify(model, ctx);

    expect(finding?.counterexample?.state).toBe('submitted');
    expect(finding?.counterexample?.['witness.state']).toBe('draft');
  });

  it('Finding は「何が・どこで・どう直すか」の 3 点セットを満たす', () => {
    const model = entryModel({ guardA: 'score >= 5', guardB: 'score >= 3' });
    const { ctx } = stubContext({ defaultCoexist: true });

    const [finding] = determinismVerifier.verify(model, ctx);

    expect(finding?.message).toContain('非決定');
    expect(finding?.location.file).toBe('docs/specs/domain/test/states.md');
    expect(finding?.location.pointer).toBe('events.review[1]');
    expect(finding?.suggestion.length).toBeGreaterThan(0);
  });

  it('ガードが排他(同時成立しない)なら違反なし', () => {
    const model = entryModel({ guardA: 'score >= 5', guardB: 'score < 5' });
    const { ctx } = stubContext({ coexist: { 'score >= 5|score < 5': false } });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });

  it('行き先が同じなら同時成立してもエラーにしない', () => {
    const model = entryModel({ toB: 'accepted' });
    const { ctx } = stubContext({ defaultCoexist: true });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });

  it('ロールが重ならないなら非決定にならない', () => {
    const model = entryModel({ byB: ['system'] });
    const { ctx } = stubContext({ defaultCoexist: true });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });

  it('遷移元状態が重ならないなら非決定にならない', () => {
    const model = specModel({
      roles: [role('organizer')],
      aggregates: [
        aggregate({
          name: 'entry',
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['draft', 'submitted', 'accepted', 'rejected'],
              events: [
                event({ id: 'review', from: ['submitted'], to: 'accepted', by: ['organizer'] }),
                event({ id: 'review', from: ['draft'], to: 'rejected', by: ['organizer'] }),
              ],
            }),
          ],
        }),
      ],
    });
    const { ctx } = stubContext({ defaultCoexist: true });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });

  it('ガード省略(常に真)同士は同時成立として判定に回す', () => {
    const model = entryModel();
    const { ctx, guards } = stubContext({ coexist: { [`${NO_GUARD_KEY}|${NO_GUARD_KEY}`]: true } });

    expect(determinismVerifier.verify(model, ctx)).toHaveLength(1);
    expect(guards.coexistCalls[0]).toMatchObject({ a: NO_GUARD_KEY, b: NO_GUARD_KEY });
  });

  it('パースできないガードは判定を保留し、V8 では報告しない', () => {
    const model = entryModel({ guardA: 'score >>> 5', guardB: 'score >= 3' });
    const { ctx } = stubContext({
      unparsable: { 'score >>> 5': '演算子が不正です' },
      defaultCoexist: true,
    });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });

  it('判定には状態機械の状態を展開した変数ドメインを渡す', () => {
    const model = entryModel({ guardA: 'a', guardB: 'b' });
    const { ctx, guards } = stubContext({ defaultCoexist: false });

    determinismVerifier.verify(model, ctx);

    expect(guards.coexistCalls).toHaveLength(1);
    expect(guards.coexistCalls[0]?.env.get('entry.state')).toEqual({
      kind: 'finite',
      values: ['draft', 'submitted', 'accepted', 'rejected'],
    });
  });

  it('イベント定義が 1 つずつなら何も報告しない', () => {
    const model = specModel({
      roles: [role('organizer')],
      aggregates: [
        aggregate({
          name: 'entry',
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['submitted', 'accepted'],
              events: [event({ id: 'accept', from: ['submitted'], to: 'accepted', by: ['organizer'] })],
            }),
          ],
        }),
      ],
    });
    const { ctx } = stubContext({ defaultCoexist: true });

    expect(determinismVerifier.verify(model, ctx)).toEqual([]);
  });
});
