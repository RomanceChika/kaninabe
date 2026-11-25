/**
 * Y9(ユースケース仕様 ⇔ テストの突合)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「保存点ごとに署名と本文の 2 件を宣言する」
 * 「`test_cases[].implementation` が実在するテストの `@tc` と一致する」
 * 「`spec_ids` はドメインの仕様 ID か、そのユースケース自身の id」。
 */

import { describe, expect, it } from 'vitest';
import { testTraceVerifier } from '../../../../lib/usecase/verifiers/y9-test-trace.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import type { ActionTestCase } from '../../../../lib/testcase/types.js';
import type { UsecaseSpec } from '../../../../lib/model/usecase/types.js';
import type { TestScanResult } from '../../../../lib/testcase/types-scan.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

const TEST_FILE = 'app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts';

/** test_cases 1 件を作る。 */
function testCase(id: string, testName: string, specId = 'usecase-demo'): ActionTestCase {
  return {
    id,
    type: 'integration',
    covers: ['success'],
    specIds: [specId],
    implementation: { raw: `${TEST_FILE}::${testName}`, file: TEST_FILE, testName },
    location: { file: 'docs/specs/frontend/usecases/demo.md', pointer: `test_cases.${id}` },
  };
}

/** 保存点 1 つ + テストケース 2 件のユースケース。 */
function demo(testCases: readonly ActionTestCase[]): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', [usecaseStep('item.create')], { name: 'demo' })],
    testCases,
  });
}

/** `@tc` を持つテスト 1 件が実在する走査結果。 */
function scan(annotations: readonly { tcId: string; testName: string | null }[]): TestScanResult {
  return {
    available: true,
    testFiles: [TEST_FILE],
    actionFiles: [],
    operationFiles: [],
    annotations: annotations.map((annotation) => ({
      tcId: annotation.tcId,
      file: TEST_FILE,
      line: 1,
      testName: annotation.testName,
      specIds: [],
    })),
  };
}

describe('Y9 ユースケース仕様 ⇔ テストの突合', () => {
  it('保存点ごとの 2 件が実在するテストに接地していれば通る', () => {
    const usecase = demo([testCase('TC-USECASE-DEMO-001', '署名'), testCase('TC-USECASE-DEMO-002', '本文')]);
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });
    const registry = buildTcRegistry(collectTcEntries({ usecases: input.usecases }), []);
    const tests = scan([
      { tcId: 'TC-USECASE-DEMO-001', testName: '署名' },
      { tcId: 'TC-USECASE-DEMO-002', testName: '本文' },
    ]);

    expect(testTraceVerifier.verify(input, { ...USECASE_CTX, guards: stubGuards(), registry, tests })).toEqual([]);
  });

  it('保存点の数に対して test_cases が足りなければ違反になる', () => {
    const usecase = demo([testCase('TC-USECASE-DEMO-001', '署名')]);
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = testTraceVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y9');
    expect(findings[0]?.counterexample).toMatchObject({ declared: '1', required: '2' });
  });

  it('テスト名が食い違えば違反になる', () => {
    const usecase = demo([testCase('TC-USECASE-DEMO-001', '署名'), testCase('TC-USECASE-DEMO-002', '本文')]);
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });
    const registry = buildTcRegistry(collectTcEntries({ usecases: input.usecases }), []);
    const tests = scan([
      { tcId: 'TC-USECASE-DEMO-001', testName: '別の名前' },
      { tcId: 'TC-USECASE-DEMO-002', testName: '本文' },
    ]);

    const findings = testTraceVerifier.verify(input, { ...USECASE_CTX, guards: stubGuards(), registry, tests });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y9');
  });

  it('spec_ids が実在しない仕様を指していれば違反になる', () => {
    const usecase = demo([
      testCase('TC-USECASE-DEMO-001', '署名', 'usecase-nope'),
      testCase('TC-USECASE-DEMO-002', '本文'),
    ]);
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });
    const registry = buildTcRegistry(collectTcEntries({ usecases: input.usecases }), []);

    const findings = testTraceVerifier.verify(input, { ...USECASE_CTX, guards: stubGuards(), registry });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ spec_id: 'usecase-nope' });
  });
});
