/**
 * V14(ux 上書きは理由必須)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「方針の導出（confirm_required / variant）と ux（上書き）」。
 */

import { describe, expect, it } from 'vitest';
import { uxOverrideReasonVerifier } from '../../../../lib/trace/verifiers/v14-ux-override.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';

describe('V14 ux 上書きは理由必須', () => {
  it('ux が無ければ通る', () => {
    const input = traceInput({ actions: [actionSpec({ handles: 'entry.submit' })] });

    expect(uxOverrideReasonVerifier.verify(input)).toEqual([]);
  });

  it('reason つきの ux は通る', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'workshop.publish', ux: { confirm: 'none', reason: 'overlay が無いため' } })],
    });

    expect(uxOverrideReasonVerifier.verify(input)).toEqual([]);
  });

  it('reason が無い ux は違反になる', () => {
    const input = traceInput({ actions: [actionSpec({ handles: 'workshop.publish', ux: { confirm: 'none' } })] });

    const findings = uxOverrideReasonVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V14');
    expect(findings[0]?.message).toContain('reason がありません');
    expect(findings[0]?.counterexample).toMatchObject({ confirm: 'none' });
  });

  it('reason が空文字だけの ux も違反になる', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'workshop.publish', ux: { confirm: 'required', reason: '   ' } })],
    });

    const findings = uxOverrideReasonVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ confirm: 'required' });
  });

  it('境界: 複数の action_spec を混ぜても ux があるものだけ検査する', () => {
    const input = traceInput({
      actions: [
        actionSpec({ handles: 'entry.submit' }),
        actionSpec({ handles: 'workshop.publish', ux: { confirm: 'none' } }),
        actionSpec({ handles: 'entry.revise', ux: { confirm: 'required', reason: '理由' } }),
      ],
    });

    const findings = uxOverrideReasonVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ id: 'workshop-publish-action' });
  });
});
