import { describe, expect, it } from 'vitest';

import { reachabilityVerifier } from '../../../../lib/verify/verifiers/v5-reachability.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { event, machine, modelWithMachine, stubGuards } from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return reachabilityVerifier.verify(model, ctx);
}

describe('V5 到達可能性', () => {
  it('initial から到達できない状態を検出する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'rejected'],
        initial: 'draft',
        final: ['rejected'],
        events: [event('submit', { from: ['draft'], to: 'submitted' })],
      }),
    );

    const findings = run(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V5');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe('entry: 状態 rejected へ到達する遷移がありません');
    expect(findings[0]?.suggestion).toContain('to: rejected');
    expect(findings[0]?.counterexample).toEqual({
      machine: 'entry',
      state: 'rejected',
      initial: 'draft',
    });
    expect(findings[0]?.location.file).toBe('docs/specs/domain/entry/states.md');
  });

  it('多段の経路を辿って到達できれば違反ゼロ', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'accepted', 'published'],
        initial: 'draft',
        final: ['published'],
        events: [
          event('submit', { from: ['draft'], to: 'submitted' }),
          event('accept', { from: ['submitted'], to: 'accepted' }),
          event('publish', { from: ['accepted'], to: 'published' }),
        ],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('initial のみの状態機械は違反ゼロ', () => {
    const model = modelWithMachine(
      machine('entry', { states: ['draft'], initial: 'draft', events: [] }),
    );

    expect(run(model)).toEqual([]);
  });

  it('initial に戻る循環があっても無限ループしない', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'orphan'],
        initial: 'draft',
        events: [
          event('submit', { from: ['draft'], to: 'submitted' }),
          event('withdraw', { from: ['submitted'], to: 'draft' }),
        ],
      }),
    );

    const findings = run(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.state).toBe('orphan');
  });

  it('到達不能な状態同士が繋がっていても救済されない', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'island_a', 'island_b'],
        initial: 'draft',
        events: [event('hop', { from: ['island_a'], to: 'island_b' })],
      }),
    );

    expect(run(model).map((f) => f.counterexample?.state)).toEqual(['island_a', 'island_b']);
  });
});
