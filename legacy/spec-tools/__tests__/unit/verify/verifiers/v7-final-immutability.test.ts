import { describe, expect, it } from 'vitest';

import { finalImmutabilityVerifier } from '../../../../lib/verify/verifiers/v7-final-immutability.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import {
  aggregate,
  event,
  machine,
  modelWithMachine,
  specModel,
  stubGuards,
} from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return finalImmutabilityVerifier.verify(model, ctx);
}

describe('V7 final 不変', () => {
  it('final 状態がイベントの from に現れる場合を検出する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'withdrawn'],
        initial: 'draft',
        final: ['withdrawn'],
        events: [
          event('withdraw', { from: ['draft', 'withdrawn'], to: 'withdrawn' }),
        ],
      }),
    );

    const findings = run(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V7');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe(
      'entry: withdrawn は final ですが withdraw の from に含まれています',
    );
    expect(findings[0]?.suggestion).toContain('from から withdrawn を外す');
    expect(findings[0]?.counterexample).toEqual({
      machine: 'entry',
      state: 'withdrawn',
      event: 'withdraw',
    });
    expect(findings[0]?.location.pointer).toBe('events.withdraw');
  });

  it('final 状態が from に現れなければ違反ゼロ(to に現れるのは正常)', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'withdrawn'],
        initial: 'draft',
        final: ['withdrawn'],
        events: [
          event('submit', { from: ['draft'], to: 'submitted' }),
          event('withdraw', { from: ['draft', 'submitted'], to: 'withdrawn' }),
        ],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('final が空なら常に違反ゼロ', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft'],
        initial: 'draft',
        final: [],
        events: [event('revise', { from: ['draft'], to: 'draft' })],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('同じ final 状態を from に含むイベントが複数あればすべて報告する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'closed'],
        initial: 'draft',
        final: ['closed'],
        events: [
          event('reopen', { from: ['closed'], to: 'draft' }),
          event('touch', { from: ['closed'], to: 'closed' }),
        ],
      }),
    );

    expect(run(model).map((f) => f.counterexample?.event)).toEqual(['reopen', 'touch']);
  });

  it('複数の状態機械を横断して検査する', () => {
    const model = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'closed'],
            initial: 'draft',
            final: ['closed'],
            events: [event('reopen', { from: ['closed'], to: 'draft' })],
          }),
          machine('archive', {
            states: ['active', 'archived'],
            initial: 'active',
            final: ['archived'],
            events: [event('unarchive', { from: ['archived'], to: 'active' })],
          }),
        ],
      }),
    ]);

    expect(run(model).map((f) => f.counterexample?.machine)).toEqual(['entry', 'archive']);
  });
});
