/**
 * 仕組みの保証台帳のエントリがテストケース ID の台帳に載る形のテスト。
 *
 * 台帳は 1 本のまま両方の保証台帳を載せ、仕組みの側のエントリにだけ持ち主(`owner: 'framework'`)を付ける。
 * 持ち主を付けるのは、製品の境界の見張り(T4)が仕組みのエントリで満たされないようにするため。台帳をまたぐ ID の重複は A9 が拾う。
 */

import { describe, expect, it } from 'vitest';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { ownerOf } from '../../../lib/testcase/owner.js';
import { tcUniquenessVerifier } from '../../../lib/spec-index/verifiers/a9-tc-uniqueness.js';
import { frameworkGuaranteeModel, frameworkTestCase, guarantee, guaranteeModel } from '../../helpers/guarantee-builder.js';

const FW = frameworkGuaranteeModel([guarantee('fw_engine', { canaries: ['TC-FW-ENGINE-001'] })]);
const PRODUCT = guaranteeModel([guarantee('rows_by_rls', { canaries: ['TC-GUAR-ROWS-001'] })]);

describe('仕組みの保証台帳のエントリ', () => {
  it('仕組みの台帳のエントリには持ち主 framework が付き、製品の台帳のエントリは製品として読まれる', () => {
    const registry = buildTcRegistry(collectTcEntries({ guarantees: PRODUCT, frameworkGuarantees: FW }));

    expect(registry.find('TC-FW-ENGINE-001').map(ownerOf)).toEqual(['framework']);
    expect(registry.find('TC-GUAR-ROWS-001').map(ownerOf)).toEqual(['product']);
    expect(registry.find('TC-FW-ENGINE-001')[0]).toMatchObject({ specKind: 'guarantee_spec', specId: 'framework-guarantee-catalog' });
  });

  it('仕組みの台帳を渡さなければ、台帳は製品だけを載せる(従来と同じ)', () => {
    const registry = buildTcRegistry(collectTcEntries({ guarantees: PRODUCT }));

    expect(registry.entries.map((entry) => entry.tcId)).toEqual(['TC-GUAR-ROWS-001']);
  });

  it('台帳をまたいで同じテストケース ID があれば、A9 が重複として拾う(予約を破った製品の宣言)', () => {
    const clash = guaranteeModel([guarantee('rows_by_rls', { canaries: ['TC-FW-ENGINE-001'] })]);
    const registry = buildTcRegistry(collectTcEntries({ guarantees: clash, frameworkGuarantees: FW }));

    const findings = tcUniquenessVerifier.verify(registry);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('TC-FW-ENGINE-001');
    expect(findings[0]?.severity).toBe('error');
  });

  it('仕組みの台帳のテストケース宣言は仕組みの根の相対パスをそのまま保つ', () => {
    const model = frameworkGuaranteeModel([guarantee('fw_engine', { canaries: ['TC-FW-ENGINE-001'] })], {
      testCases: [frameworkTestCase('TC-FW-ENGINE-001', 'framework/runtime/src/a.test.ts::遷移')],
    });
    const [entry] = collectTcEntries({ frameworkGuarantees: model });

    expect(entry?.implementation.file).toBe('framework/runtime/src/a.test.ts');
  });
});
