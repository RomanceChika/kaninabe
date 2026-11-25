/**
 * Y6(達成条件)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「done が評価可能で、steps の最後の遷移の to と矛盾しない」。
 */

import { describe, expect, it } from 'vitest';
import { doneConsistencyVerifier } from '../../../../lib/usecase/verifiers/y6-done-consistency.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

describe('Y6 達成条件', () => {
  it('done が最後の遷移の to と一致すれば通る', () => {
    const usecase = usecaseSpec({
      done: 'item.state == submitted',
      saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(doneConsistencyVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('done が最後の遷移の to と食い違うと違反になる', () => {
    // done が指す状態機械・集約はここでは同じ(item)だが、状態が違う(draft のままだと主張)。
    const usecase = usecaseSpec({
      done: 'item.state == draft',
      saves: [usecaseSave('register', [usecaseStep('item.create'), usecaseStep('item.submit')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = doneConsistencyVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y6');
    expect(findings[0]?.counterexample).toMatchObject({ lastOp: 'item.submit', lastTo: 'submitted' });
  });

  it('最後の手順が遷移でない(作成)なら比べる相手が無く、指摘しない', () => {
    const usecase = usecaseSpec({
      done: 'item.state == submitted',
      saves: [usecaseSave('register', [usecaseStep('item.submit'), usecaseStep('container.create')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(doneConsistencyVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });
});
