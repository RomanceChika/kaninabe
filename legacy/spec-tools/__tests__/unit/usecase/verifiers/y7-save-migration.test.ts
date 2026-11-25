/**
 * Y7(保存点の migration)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「`migration` は `{14 桁}_usecase_{name}_{save}.sql` の形で、
 * 全ユースケース・全保存点で一意」。
 */

import { describe, expect, it } from 'vitest';
import { saveMigrationVerifier } from '../../../../lib/usecase/verifiers/y7-save-migration.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

/** name=demo のユースケース 1 件(保存点 1 つ)。 */
function demo(migration: string, saveId = 'register'): ReturnType<typeof usecaseSpec> {
  return usecaseSpec({
    name: 'demo',
    saves: [usecaseSave(saveId, [usecaseStep('item.create')], { migration })],
  });
}

describe('Y7 保存点の migration', () => {
  it('{14 桁}_usecase_{name}_{save}.sql の形なら通る', () => {
    const input = usecaseInput({
      usecases: { available: true, usecases: [demo('20260909000050_usecase_demo_register.sql')] },
    });

    expect(saveMigrationVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('連番が 14 桁でなければ違反になる', () => {
    const input = usecaseInput({
      usecases: { available: true, usecases: [demo('202609_usecase_demo_register.sql')] },
    });

    const findings = saveMigrationVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y7');
    expect(findings[0]?.counterexample?.['expected']).toBe('{14 桁}_usecase_demo_register.sql');
  });

  it('ユースケース名・保存点 ID と食い違う名前は違反になる', () => {
    const input = usecaseInput({
      usecases: { available: true, usecases: [demo('20260909000050_usecase_other_register.sql')] },
    });

    const findings = saveMigrationVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('保存点から導かれる名前になっていません');
  });

  it('2 つの保存点が同じ migration を指すと違反になる', () => {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('a', [usecaseStep('item.create')], { migration: '20260909000050_usecase_demo_a.sql' }),
        usecaseSave('b', [usecaseStep('item.submit')], { migration: '20260909000050_usecase_demo_a.sql' }),
      ],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = saveMigrationVerifier.verify(input, USECASE_CTX);

    // 形式違反(b の名前が導出と食い違う)と重複の 2 件が出る。
    expect(findings.some((finding) => finding.message.includes('重複しています'))).toBe(true);
  });
});
