/**
 * A1(handles の実在)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「宣言されたドメインイベント ID が state_spec に存在する。
 * 予約 ID {entity}.create / .delete / .update は access_spec の creates / deletes / writes が実在条件」。
 */

import { describe, expect, it } from 'vitest';
import { handlesExistenceVerifier } from '../../../../lib/trace/verifiers/a1-handles-existence.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';

/** entry 機械に submit / revise を持つドメイン。creates を渡すと作成宣言も載る。 */
function domain(creates: readonly ReturnType<typeof createRule>[] = []) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        ...(creates.length === 0 ? {} : { access: accessSpec('entry', { creates }) }),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted' }),
              event({ id: 'revise', from: ['submitted'], to: 'draft' }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** 遷移を持たず access_spec の宣言だけを持つ entry 集約。 */
function accessOnlyDomain(init: {
  deletes?: readonly ReturnType<typeof deleteRule>[];
  writes?: readonly ReturnType<typeof writeRule>[];
}) {
  return specModel({
    aggregates: [aggregate({ name: 'entry', access: accessSpec('entry', init) })],
  });
}

describe('A1 handles の実在', () => {
  it('state_spec に実在するイベントを handles していれば通る', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.submit' })] });

    expect(handlesExistenceVerifier.verify(input)).toEqual([]);
  });

  it('機械はあるがイベント名が無いと違反になる', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.approve' })] });

    const findings = handlesExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A1');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('entry.approve');
    expect(findings[0]?.suggestion).toContain('submit, revise');
  });

  it('状態機械そのものが無いと違反になり、機械を作る案が出る', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'workshop.publish' })] });

    const findings = handlesExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('状態機械 workshop が specs/domain にありません');
  });

  it('予約 ID {entity}.create は creates が宣言されていれば通る', () => {
    const input = traceInput({
      domain: domain([createRule('member', 'workshop.state == accepting')]),
      actions: [actionSpec({ handles: 'entry.create' })],
    });

    expect(handlesExistenceVerifier.verify(input)).toEqual([]);
  });

  it('creates が無いのに {entity}.create を handles すると違反になる', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.create' })] });

    const findings = handlesExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A1');
    expect(findings[0]?.message).toContain('creates');
    expect(findings[0]?.suggestion).toContain('specs/domain/entry/access.md');
    expect(findings[0]?.counterexample).toMatchObject({ handles: 'entry.create' });
  });

  it('境界: create は state_spec の events を見ない(同名イベントがあっても creates が正)', () => {
    const input = traceInput({
      domain: specModel({
        aggregates: [
          aggregate({
            name: 'entry',
            stateMachines: [
              machine({
                machine: 'entry',
                states: ['draft'],
                events: [event({ id: 'create', from: ['draft'], to: 'draft' })],
              }),
            ],
          }),
        ],
      }),
      actions: [actionSpec({ handles: 'entry.create' })],
    });

    expect(handlesExistenceVerifier.verify(input)).toHaveLength(1);
  });

  it('予約 ID {entity}.delete は deletes が宣言されていれば通る', () => {
    const input = traceInput({
      domain: accessOnlyDomain({ deletes: [deleteRule('performer', 'state == draft')] }),
      actions: [actionSpec({ handles: 'entry.delete' })],
    });

    expect(handlesExistenceVerifier.verify(input)).toEqual([]);
  });

  it('deletes が無いのに {entity}.delete を handles すると違反になる', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.delete' })] });

    const findings = handlesExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A1');
    expect(findings[0]?.message).toContain('deletes');
    expect(findings[0]?.suggestion).toContain('specs/domain/entry/access.md');
    expect(findings[0]?.counterexample).toMatchObject({ handles: 'entry.delete', declared_deletes: '(なし)' });
  });

  it('予約 ID {entity}.update は writes が宣言されていれば通る', () => {
    const input = traceInput({
      domain: accessOnlyDomain({ writes: [writeRule('performer', ['title'], 'state == draft')] }),
      actions: [actionSpec({ handles: 'entry.update' })],
    });

    expect(handlesExistenceVerifier.verify(input)).toEqual([]);
  });

  it('writes が無いのに {entity}.update を handles すると違反になる', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.update' })] });

    const findings = handlesExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('writes');
  });

  it('境界: action_spec が 0 件なら違反は出ない', () => {
    expect(handlesExistenceVerifier.verify(traceInput({ domain: domain() }))).toEqual([]);
  });

  it('境界: 同名イベントが別の機械にあっても機械名まで一致しないと違反になる', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          stateMachines: [
            machine({
              machine: 'workshop',
              states: ['draft', 'accepting'],
              events: [event({ id: 'submit', from: ['draft'], to: 'accepting' })],
            }),
          ],
        }),
      ],
    });
    const input = traceInput({ domain: model, actions: [actionSpec({ handles: 'entry.submit' })] });

    expect(handlesExistenceVerifier.verify(input)).toHaveLength(1);
  });
});
