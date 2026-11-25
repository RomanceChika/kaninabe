/**
 * Z2(未執行の警告)の規約網羅テスト。
 * 対象の要求: guarantee-spec-writing.md「status: planned の保証 1 件につき warning を出す。
 * 免除の口は無い」。
 */

import { describe, expect, it } from 'vitest';
import { verifyPlannedGuarantees } from '../../../../lib/guarantee/verifiers/z2-planned.js';
import { guarantee, guaranteeModel } from '../../../helpers/guarantee-builder.js';

describe('Z2 未執行の警告', () => {
  it('enforced だけなら warning は出ない', () => {
    const model = guaranteeModel([guarantee('rows_by_rls')]);

    expect(verifyPlannedGuarantees(model)).toEqual([]);
  });

  it('planned の保証 1 件につき 1 件の warning を出す', () => {
    const model = guaranteeModel([
      guarantee('rows_by_rls'),
      guarantee('api_surface_only', { status: 'planned', plannedReason: '着手待ち' }),
    ]);

    const findings = verifyPlannedGuarantees(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Z2');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toBe('保証 api_surface_only はまだ執行されていない: 着手待ち');
  });

  it('planned が複数あれば、その数だけ warning が出る(免除の口が無いため毎回出続ける)', () => {
    const model = guaranteeModel([
      guarantee('api_surface_only', { status: 'planned', plannedReason: '理由1' }),
      guarantee('hidden_columns_masked', { status: 'planned', plannedReason: '理由2' }),
    ]);

    expect(verifyPlannedGuarantees(model)).toHaveLength(2);
  });

  it('カタログを読めていなければ何も出さない', () => {
    expect(verifyPlannedGuarantees({ available: true, catalog: null })).toEqual([]);
  });
});
