/**
 * A5(重複の禁止)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「同じイベントを handles する action_spec が 2 つ以上ない」。
 */

import { describe, expect, it } from 'vitest';
import { noDuplicateHandlesVerifier } from '../../../../lib/trace/verifiers/a5-no-duplicate-handles.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';

describe('A5 重複の禁止', () => {
  it('handles が全て異なれば通る', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit' }), actionSpec({ handles: 'entry.revise' })],
    });

    expect(noDuplicateHandlesVerifier.verify(input)).toEqual([]);
  });

  it('同じイベントを handles する仕様が 2 つあると違反になる', () => {
    const input = traceInput({
      actions: [
        actionSpec({ handles: 'entry.submit' }),
        actionSpec({ handles: 'entry.submit', id: 'entry-submit2-action', relPath: 'entry/submit2.md' }),
      ],
    });

    const findings = noDuplicateHandlesVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A5');
    expect(findings[0]?.counterexample).toMatchObject({
      handles: 'entry.submit',
      first: 'docs/specs/backend/actions/entry/submit.md',
      duplicate: 'docs/specs/backend/actions/entry/submit2.md',
    });
  });

  it('3 つ重複したら 2 件の違反が出る(先頭以外すべて)', () => {
    const input = traceInput({
      actions: [
        actionSpec({ handles: 'entry.submit', id: 'entry-a-action', relPath: 'entry/a.md' }),
        actionSpec({ handles: 'entry.submit', id: 'entry-b-action', relPath: 'entry/b.md' }),
        actionSpec({ handles: 'entry.submit', id: 'entry-c-action', relPath: 'entry/c.md' }),
      ],
    });

    const findings = noDuplicateHandlesVerifier.verify(input);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.counterexample?.['duplicate'])).toEqual([
      'docs/specs/backend/actions/entry/b.md',
      'docs/specs/backend/actions/entry/c.md',
    ]);
  });

  it('id の重複も違反になる', () => {
    const input = traceInput({
      actions: [
        actionSpec({ handles: 'entry.submit', id: 'entry-submit-action' }),
        actionSpec({ handles: 'entry.revise', id: 'entry-submit-action' }),
      ],
    });

    const findings = noDuplicateHandlesVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('id entry-submit-action');
  });

  it('境界: action_spec が 1 件以下なら違反は出ない', () => {
    expect(noDuplicateHandlesVerifier.verify(traceInput({}))).toEqual([]);
    expect(
      noDuplicateHandlesVerifier.verify(traceInput({ actions: [actionSpec({ handles: 'entry.submit' })] })),
    ).toEqual([]);
  });
});
