/**
 * Y11(手順の鍵の一意性)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「同じ操作を 1 つの保存点で 2 回以上書くときは `as` で
 * 別名を付ける。鍵(`as`。無ければ `op`)は保存点の中で一意」。
 */

import { describe, expect, it } from 'vitest';
import { stepKeyVerifier } from '../../../../lib/usecase/verifiers/y11-step-key.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import type { UsecaseStepDecl } from '../../../../lib/model/usecase/types.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

/** 手順を並べた保存点 1 つのユースケース。 */
function demo(steps: readonly UsecaseStepDecl[]): ReturnType<typeof usecaseSpec> {
  return usecaseSpec({ name: 'demo', saves: [usecaseSave('register', steps, { name: 'demo' })] });
}

/** 検査を 1 回回す。 */
function verify(steps: readonly UsecaseStepDecl[]): ReturnType<typeof stepKeyVerifier.verify> {
  return stepKeyVerifier.verify(
    usecaseInput({ usecases: { available: true, usecases: [demo(steps)] } }),
    USECASE_CTX,
  );
}

describe('Y11 手順の鍵の一意性', () => {
  it('別名が無く操作 ID も重ならなければ通る', () => {
    expect(verify([usecaseStep('container.create'), usecaseStep('item.create')])).toEqual([]);
  });

  it('同じ操作を 2 回書いても、別名が違えば通る', () => {
    const steps = [
      usecaseStep('container.create'),
      usecaseStep('item.create', { as: 'self' }),
      usecaseStep('item.create', { as: 'others', repeat: true }),
    ];

    expect(verify(steps)).toEqual([]);
  });

  it('同じ操作を別名なしで 2 回書くと違反になる', () => {
    const findings = verify([usecaseStep('item.create'), usecaseStep('item.create')]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y11');
    expect(findings[0]?.counterexample?.['key']).toBe('item.create');
  });

  it('別名が重なれば違反になる', () => {
    const findings = verify([
      usecaseStep('item.create', { as: 'self' }),
      usecaseStep('container.create', { as: 'self' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('鍵 self が重複しています');
  });

  it('別名が「別名を書かなかった手順の鍵(= 操作 ID)」と重なれば違反になる', () => {
    const findings = verify([
      usecaseStep('item.create'),
      usecaseStep('container.create', { as: 'item.create' }),
    ]);

    // as は snake_case しか書けない(パーサが見る)が、鍵が重なる経路そのものは検査が見る。
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['first']).toBe('item.create');
  });
});
