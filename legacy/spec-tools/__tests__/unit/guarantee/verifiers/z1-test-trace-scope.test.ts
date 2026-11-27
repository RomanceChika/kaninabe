/**
 * Z1 の突合が付ける印(`absentFor`)の持ち主。
 *
 *   - 製品の台帳のエントリが製品の木のテストを指して不在なら、持ち主は保証台帳(`catalog` / `guarantee-catalog`)で、印が付く
 *   - 仕組みの見張りテストの置き場の下を指すエントリは、**仕組みの走査**で見る別の世界のテストなので、持ち主は `null`(印を付けない)。
 *     製品が実装の範囲を宣言しても、仕組み自身の見張りテストの不在は外れない
 *   - テストはあるが名前が違うときは、どちらの世界でも印を付けない
 */

import { describe, expect, it } from 'vitest';
import { verifyGuaranteeTestTrace } from '../../../../lib/guarantee/verifiers/z1-test-trace.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import type { FrameworkScan } from '../../../../lib/testcase/types-scan-framework.js';
import { aggregate, specModel } from '../../../helpers/model-builder.js';
import { guarantee, guaranteeModel, guaranteeTestCase } from '../../../helpers/guarantee-builder.js';
import { annotation, scanResult } from '../../../helpers/trace-builder.js';

const PRODUCT_FILE = 'app/src/infrastructure/__tests__/guarantees/rows.test.ts';
const PRODUCT_TC = 'TC-GUAR-ROWS-001';
const FRAMEWORK_FILE = 'legacy/spec-tools/__tests__/guarantees/wiring.test.ts';
const FRAMEWORK_TC = 'TC-GUAR-WIRING-001';

const model = guaranteeModel([guarantee('rows_by_rls', { canaries: [PRODUCT_TC] }), guarantee('wiring', { canaries: [FRAMEWORK_TC] })], {
  testCases: [guaranteeTestCase(PRODUCT_TC, `${PRODUCT_FILE}::行が返らない`), guaranteeTestCase(FRAMEWORK_TC, `${FRAMEWORK_FILE}::配線`)],
});
const registry = buildTcRegistry(collectTcEntries({ guarantees: model }));
const domain = specModel([aggregate('entry')]);

/** 仕組みの走査(読めた形)。 */
const frameworkScan = (init: Partial<FrameworkScan> = {}): FrameworkScan => ({
  state: { state: 'scanned' },
  testFiles: [FRAMEWORK_FILE],
  annotations: [annotation({ tcId: FRAMEWORK_TC, file: FRAMEWORK_FILE, testName: '配線' })],
  ...init,
});

describe('Z1 の印の持ち主', () => {
  it('製品の木のテストが不在: 保証台帳を持ち主に印が付く', () => {
    const tests = { ...scanResult({ testFiles: [], annotations: [] }), framework: frameworkScan() };

    const findings = verifyGuaranteeTestTrace(domain, registry, tests);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(`${PRODUCT_TC} の implementation が指すテストファイルがありません`);
    expect(findings[0]?.absentFor).toEqual({ kind: 'catalog', id: 'guarantee-catalog' });
  });

  it('仕組みの見張りテストの不在(仕組みの走査に @tc が無い): 印を付けない(持ち主 null)', () => {
    const tests = {
      ...scanResult({ testFiles: [PRODUCT_FILE], annotations: [annotation({ tcId: PRODUCT_TC, file: PRODUCT_FILE, testName: '行が返らない' })] }),
      framework: frameworkScan({ annotations: [] }),
    };

    const findings = verifyGuaranteeTestTrace(domain, registry, tests);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(`${FRAMEWORK_TC} に対応する "@tc ${FRAMEWORK_TC}" がテストコードにありません`);
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('仕組みの見張りテストのファイルが無い: 印を付けない(持ち主 null)', () => {
    const tests = {
      ...scanResult({ testFiles: [PRODUCT_FILE], annotations: [annotation({ tcId: PRODUCT_TC, file: PRODUCT_FILE, testName: '行が返らない' })] }),
      framework: frameworkScan({ testFiles: [], annotations: [] }),
    };

    const findings = verifyGuaranteeTestTrace(domain, registry, tests);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('名前の食い違いは、製品でも仕組みでも印を付けない(あるが違う)', () => {
    const tests = {
      ...scanResult({ testFiles: [PRODUCT_FILE], annotations: [annotation({ tcId: PRODUCT_TC, file: PRODUCT_FILE, testName: '別の名前' })] }),
      framework: frameworkScan({ annotations: [annotation({ tcId: FRAMEWORK_TC, file: FRAMEWORK_FILE, testName: '別の名前' })] }),
    };

    const findings = verifyGuaranteeTestTrace(domain, registry, tests);

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.message).toContain('テスト名が implementation と一致しません');
      expect(finding.absentFor).toBeUndefined();
    }
  });
});
