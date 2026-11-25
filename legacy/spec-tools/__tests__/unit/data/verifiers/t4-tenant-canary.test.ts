/**
 * T4(テナント境界の見張りテストの宣言)の規約網羅テスト。束 ⑲-2a。
 *
 * 対象の要求: `reads[].filters` で境界を宣言した表は、「他のテナントの行が返らない」ことを
 * 確かめる見張りテストの宣言を 1 件持つ。宣言の置き場は data_table でも保証台帳でもよい
 * (どちらも同じテストケース ID 台帳に載るので、見るのは**テスト名の実在**だけである)。
 */

import { describe, expect, it } from 'vitest';
import { tenantCanaryTestName } from '../../../../lib/messages/messages-rls.js';
import { verifyTenantCanaries } from '../../../../lib/data/verifiers/t4-tenant-canary.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { ActionTestCase } from '../../../../lib/testcase/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { frameworkGuaranteeModel, frameworkTestCase, guarantee } from '../../../helpers/guarantee-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  loc,
  readRule,
  role,
  specModel,
} from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const TABLE = 'stores';
const CANARY_FILE = 'app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts';

/** 境界を宣言した store 集約(テナントの列は `company_id`)。 */
function domain(withFilters = true): SpecModel {
  const rule = readRule('staff_member', { kind: 'all' });
  return specModel({
    roles: [role('staff_member')],
    aggregates: [
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('company_id', { kind: 'ref', entity: 'company' })]),
        access: accessSpec('store', {
          reads: [
            withFilters ? { ...rule, filters: [{ field: 'company_id', actorField: 'company_id' }] } : rule,
          ],
        }),
      }),
    ],
  });
}

/** 規約どおりの宛先を指す見張りテストの宣言 1 件。 */
function canaryCase(testName: string): ActionTestCase {
  return {
    id: 'TC-TABLE-STORES-002',
    type: 'integration',
    specIds: [],
    covers: ['forbidden'],
    implementation: { raw: `${CANARY_FILE}::${testName}`, file: CANARY_FILE, testName },
    location: loc(`docs/specs/backend/data/tables/${TABLE}.md`, 'test_cases[0]'),
  };
}

/** 表 1 つのモデル(見張りテストの宣言は渡したものだけ)。 */
function tables(testCases: readonly ActionTestCase[] = []): DataTableSpecModel {
  return dataTableModel([dataTable(TABLE, { entity: 'store', testCases })]);
}

/** 台帳を data_table だけから構築する。 */
function registryOf(model: DataTableSpecModel) {
  return buildTcRegistry(collectTcEntries({ dataTables: model }));
}

describe('T4 テナント境界の見張りテストの宣言', () => {
  it('境界を宣言したのに見張りテストの宣言が無ければエラー(宣言だけで出荷させない)', () => {
    const model = tables();
    const findings = verifyTenantCanaries(domain(), model, registryOf(model), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample?.['expected_test']).toBe(
      tenantCanaryTestName(TABLE, 'company_id'),
    );
  });

  it('規約どおりのテスト名の宣言があれば通る', () => {
    const model = tables([canaryCase(tenantCanaryTestName(TABLE, 'company_id'))]);

    expect(verifyTenantCanaries(domain(), model, registryOf(model), TEST_ROOTS)).toEqual([]);
  });

  it('別の表の見張りテストでは通らない(表ごとに要る)', () => {
    const model = tables([canaryCase(tenantCanaryTestName('other_table', 'company_id'))]);

    expect(verifyTenantCanaries(domain(), model, registryOf(model), TEST_ROOTS)).toHaveLength(1);
  });

  it('境界を宣言していない仕様には何も要求しない', () => {
    const model = tables();

    expect(verifyTenantCanaries(domain(false), model, registryOf(model), TEST_ROOTS)).toEqual([]);
  });

  it('テーブル仕様を持たないエンティティは対象外(宣言の宛先の名前が決まらない)', () => {
    const model = dataTableModel([]);

    expect(verifyTenantCanaries(domain(), model, registryOf(model), TEST_ROOTS)).toEqual([]);
  });

  it('仕組みの台帳のエントリは製品の境界の見張りを満たさない(持ち主が製品のものだけを数える)', () => {
    const name = tenantCanaryTestName(TABLE, 'company_id');
    const model = tables();
    const framework = frameworkGuaranteeModel([guarantee('fw_wrong_home', { canaries: ['TC-FW-WRONGHOME-001'] })], {
      testCases: [frameworkTestCase('TC-FW-WRONGHOME-001', `framework/runtime/src/__tests__/x.test.ts::${name}`)],
    });
    const registry = buildTcRegistry(collectTcEntries({ dataTables: model, frameworkGuarantees: framework }));

    // 同じテスト名の宣言が仕組みの台帳に在っても、製品の境界は見張られていないまま。
    expect(registry.entries.map((entry) => entry.implementation.testName)).toContain(name);
    expect(verifyTenantCanaries(domain(), model, registry, TEST_ROOTS)).toHaveLength(1);
  });
});
