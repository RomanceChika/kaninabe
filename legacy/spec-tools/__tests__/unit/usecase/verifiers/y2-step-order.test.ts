/**
 * Y2(順序の整合)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「手順の入力が指す集約の `.create` が、その手順より前にある」。
 */

import { describe, expect, it } from 'vitest';
import { stepOrderVerifier } from '../../../../lib/usecase/verifiers/y2-step-order.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { blockedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

describe('Y2 順序の整合', () => {
  it('参照先の作成が前にあれば通る', () => {
    const usecase = usecaseSpec({
      saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(stepOrderVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('参照先の作成が後ろにあると違反になる(逆順)', () => {
    const usecase = usecaseSpec({
      saves: [usecaseSave('register', [usecaseStep('item.create'), usecaseStep('container.create')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = stepOrderVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y2');
    expect(findings[0]?.counterexample).toMatchObject({ op: 'item.create', refers: 'container' });
  });

  it('参照先の作成がユースケースの外(steps に無い)なら指摘しない', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', [usecaseStep('item.create')])] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(stepOrderVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('action_spec が阻害なら判定を出さない(入力欄を読めない)。未選択は「action_spec は無い」事実で従来どおり', () => {
    const usecase = usecaseSpec({
      saves: [usecaseSave('register', [usecaseStep('item.create'), usecaseStep('container.create')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(stepOrderVerifier.verify(input, { ...USECASE_CTX, actions: blockedInput('load-failed') })).toEqual([]);
    expect(stepOrderVerifier.verify(input, { ...USECASE_CTX, actions: UNSELECTED })).toHaveLength(1);
  });
});

