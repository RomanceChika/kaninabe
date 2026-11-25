/**
 * Y3(到達)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「actor が start から、各 step を出す画面に届く」。
 */

import { describe, expect, it } from 'vitest';
import { reachabilityVerifier } from '../../../../lib/usecase/verifiers/y3-reachability.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { USECASE_CTX, testScreens, usecaseInput } from '../_fixtures.js';

const VALID_STEPS = [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')];

describe('Y3 到達', () => {
  it('start から navigations で各手順の画面に届けば通る', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(reachabilityVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('actor が start に入れないと違反になる', () => {
    const usecase = usecaseSpec({ actor: 'anonymous', saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = reachabilityVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y3');
    expect(findings[0]?.message).toContain('入れません');
  });

  it('手順を出す画面が start から届かないと違反になる', () => {
    // detail への辺(go_detail)を持たない画面だけを screens にする(list と detail が孤立)。
    const list = screenSpec({ name: 'list', for: ['member'], requiresAuth: true, actions: ['container.create'] });
    const detail = screenSpec({ name: 'detail', for: ['member'], requiresAuth: true, actions: ['item.create', 'item.submit'] });
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({
      usecases: { available: true, usecases: [usecase] },
      screens: { ...testScreens(), screens: [list, detail] },
    });

    const findings = reachabilityVerifier.verify(input, USECASE_CTX);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.verifier === 'Y3')).toBe(true);
    expect(findings.map((f) => f.counterexample?.['op'])).toEqual(
      expect.arrayContaining(['item.create', 'item.submit']),
    );
  });
});

describe('Y3 画面の到達の入力が使えないとき(関係の層の gaps)', () => {
  /** actor が start に入れない = 入力が使えれば違反が 1 件出る形。 */
  const unreachable = () => {
    const usecase = usecaseSpec({ actor: 'anonymous', saves: [usecaseSave('register', VALID_STEPS)] });
    return usecaseInput({ usecases: { available: true, usecases: [usecase] } });
  };

  it('使える入力(gaps が空・省略)なら従来どおり判定する', () => {
    expect(reachabilityVerifier.verify(unreachable(), USECASE_CTX)).toHaveLength(1);
    expect(reachabilityVerifier.verify(unreachable(), { ...USECASE_CTX, reachabilityGaps: [] })).toHaveLength(1);
  });

  it.each([
    ['未選択', { input: 'screens', state: 'unselected' }],
    ['阻害', { input: 'screens', state: 'blocked', reason: 'load-failed' }],
  ] as const)('%s なら判定を出さない', (_name, gap) => {
    expect(reachabilityVerifier.verify(unreachable(), { ...USECASE_CTX, reachabilityGaps: [gap] })).toEqual([]);
  });
});
