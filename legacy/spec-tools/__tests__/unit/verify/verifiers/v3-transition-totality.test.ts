import { describe, expect, it } from 'vitest';

import { transitionTotalityVerifier } from '../../../../lib/verify/verifiers/v3-transition-totality.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import {
  event,
  forbidden,
  machine,
  modelWithMachine,
  stubGuards,
} from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return transitionTotalityVerifier.verify(model, ctx);
}

const STATES = ['draft', 'submitted', 'accepted'] as const;

describe('V3 全域性(遷移)', () => {
  it('otherwise_forbidden の無いイベントで未分類の状態を反例つきで検出する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: [...STATES],
        initial: 'draft',
        events: [event('revise', { from: ['draft'], to: 'draft' })],
      }),
    );

    const findings = run(model);

    expect(findings.map((f) => f.counterexample?.state)).toEqual(['submitted', 'accepted']);
    expect(findings[0]?.verifier).toBe('V3');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe(
      'entry: 状態 submitted × イベント revise が未定義です(otherwise_forbidden もなし)',
    );
    expect(findings[0]?.suggestion).toContain('otherwise_forbidden');
    expect(findings[0]?.counterexample).toEqual({
      machine: 'entry',
      state: 'submitted',
      event: 'revise',
    });
    expect(findings[0]?.location.pointer).toBe('events.revise');
  });

  it('otherwise_forbidden があれば from に無い状態は救済される', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: [...STATES],
        initial: 'draft',
        events: [
          event('revise', {
            from: ['draft'],
            to: 'draft',
            otherwiseForbidden: '修正は下書きに対してのみ行う',
          }),
        ],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('forbidden ブロックで個別に理由が書かれた状態は救済される', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: [...STATES],
        initial: 'draft',
        events: [event('revise', { from: ['draft'], to: 'draft' })],
        forbidden: [
          forbidden('revise', ['submitted'], '提出済みは世話役確認中のため修正できない'),
          forbidden('revise', ['accepted'], '受理後の修正はプログラムに影響するため不可'),
        ],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('全状態が from に並んでいれば理由が無くても通る', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: [...STATES],
        initial: 'draft',
        events: [event('touch', { from: [...STATES], to: 'draft' })],
      }),
    );

    expect(run(model)).toEqual([]);
  });

  it('空文字の otherwise_forbidden / reason は理由として扱わない', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [event('revise', { from: ['draft'], to: 'draft', otherwiseForbidden: '   ' })],
        forbidden: [forbidden('revise', ['submitted'], '')],
      }),
    );

    const findings = run(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.state).toBe('submitted');
  });

  it('イベントが 1 つも無い状態機械は違反ゼロ(検査対象のマスが無い)', () => {
    const model = modelWithMachine(
      machine('entry', { states: ['draft'], initial: 'draft', events: [] }),
    );

    expect(run(model)).toEqual([]);
  });
});
