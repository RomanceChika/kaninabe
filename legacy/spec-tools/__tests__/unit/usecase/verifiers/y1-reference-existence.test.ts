/**
 * Y1(参照実在)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「actor が実在するグローバル人間ロール、start が実在する
 * 画面、steps[].op がドメイン仕様に接地、done が評価可能な形であること」。
 */

import { describe, expect, it } from 'vitest';
import { referenceExistenceVerifier } from '../../../../lib/usecase/verifiers/y1-reference-existence.js';
import { role, specModel } from '../../../helpers/model-builder.js';
import { usecaseAcceptInvariant, usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { USECASE_CTX, testDomain, usecaseInput } from '../_fixtures.js';

const VALID_STEPS = [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')];

describe('Y1 参照実在', () => {
  it('actor / start / steps / done がすべて実在すれば通る', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(referenceExistenceVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('actor が roles.md に無いと違反になる', () => {
    const usecase = usecaseSpec({ actor: 'ghost', saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y1');
    expect(findings[0]?.message).toContain('roles.md にありません');
  });

  it('actor が文脈依存ロールだと違反になる', () => {
    const base = testDomain();
    const domain = specModel([...base.aggregates.values()], {
      roles: [...base.roles.roles, role('owner', 'item.owner_id == actor.id')],
      location: base.roles.location,
    });
    const usecase = usecaseSpec({ actor: 'owner', saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] }, domain });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings.some((f) => f.message.includes('文脈依存ロール'))).toBe(true);
  });

  it('start が実在しない画面だと違反になる', () => {
    const usecase = usecaseSpec({ start: 'screen-nope', saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings.some((f) => f.message.includes('実在する画面ではありません'))).toBe(true);
  });

  it('steps の op がドメイン仕様に接地しないと違反になる', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', [usecaseStep('item.nope')])] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings.some((f) => f.message.includes('接地しません'))).toBe(true);
  });

  it('done が評価できない形だと違反になる', () => {
    const usecase = usecaseSpec({ done: 'item.state == nope', saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings.some((f) => f.message.includes('評価できません'))).toBe(true);
  });

  it('accept が名指しする不変条件が実在しないと違反になる(受け入れの宣言が宙に浮かない)', () => {
    const usecase = {
      ...usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] }),
      accept: [usecaseAcceptInvariant('INV-NOPE-001', '理由')],
    };
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = referenceExistenceVerifier.verify(input, USECASE_CTX);

    expect(findings.some((f) => f.message.includes('INV-NOPE-001'))).toBe(true);
  });

  it('画面が阻害のとき start の実在は言わない(落とした画面を「実在しない」と言わない。ほかの参照は従来どおり)', () => {
    const usecase = usecaseSpec({ start: 'screen-nope', saves: [usecaseSave('register', [usecaseStep('item.nope')])] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });
    const blocked = { ...USECASE_CTX, reachabilityGaps: [{ input: 'screens', state: 'blocked', reason: 'invalid' }] } as const;

    const messages = referenceExistenceVerifier.verify(input, blocked).map((f) => f.message);

    expect(messages.some((message) => message.includes('実在する画面ではありません'))).toBe(false);
    expect(messages.some((message) => message.includes('item.nope'))).toBe(true);
    // 対: 関門(auth)の阻害は start の実在に関わらない
    const authBlocked = { ...USECASE_CTX, reachabilityGaps: [{ input: 'auth', state: 'blocked', reason: 'invalid' }] } as const;
    expect(referenceExistenceVerifier.verify(input, authBlocked).some((f) => f.message.includes('実在する画面ではありません'))).toBe(true);
  });
});
