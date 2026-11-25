/**
 * fast-check の種の配線のテスト。固定が外れると、CI と pre-commit が実行ごとに別の入力を試す。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('fast-check の種', () => {
  it('setupFiles が種を決めている(FUZZ_SEED が無ければ固定の値、あればその値)', () => {
    const expected = Number(process.env['FUZZ_SEED'] ?? '') || 20_261_101;
    expect(fc.readConfigureGlobal().seed).toBe(expected);
  });
});
