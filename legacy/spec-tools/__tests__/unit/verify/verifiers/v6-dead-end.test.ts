import { describe, expect, it } from 'vitest';

import { deadEndVerifier } from '../../../../lib/verify/verifiers/v6-dead-end.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { event, machine, modelWithMachine, stubGuards } from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return deadEndVerifier.verify(model, ctx);
}

describe('V6 デッドエンド', () => {
  it('final でないのに出口が無い状態を検出する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        final: [],
        events: [event('submit', { from: ['draft'], to: 'submitted' })],
      }),
    );

    const findings = run(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V6');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe(
      'entry: 状態 submitted から出る遷移がありません(final でもない)',
    );
    expect(findings[0]?.suggestion).toContain('final');
    expect(findings[0]?.counterexample).toEqual({ machine: 'entry', state: 'submitted' });
  });

  it('出口の無い状態が final なら違反ゼロ', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'withdrawn'],
        initial: 'draft',
        final: ['withdrawn'],
        events: [event('withdraw', { from: ['draft'], to: 'withdrawn' })],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('自己ループも出ていく遷移として数える', () => {
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

  it('複数の行き止まりをすべて列挙する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'a', 'b'],
        initial: 'draft',
        final: [],
        events: [
          event('to_a', { from: ['draft'], to: 'a' }),
          event('to_b', { from: ['draft'], to: 'b' }),
        ],
      }),
    );

    expect(run(model).map((f) => f.counterexample?.state)).toEqual(['a', 'b']);
  });

  it('到達不能な状態でも出口が無ければ検出する(V5 とは独立)', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'orphan'],
        initial: 'draft',
        final: [],
        events: [event('revise', { from: ['draft'], to: 'draft' })],
      }),
    );

    expect(run(model).map((f) => f.counterexample?.state)).toEqual(['orphan']);
  });
});
