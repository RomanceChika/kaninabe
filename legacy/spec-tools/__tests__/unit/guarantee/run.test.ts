/**
 * 保証台帳の実行口(`runGuaranteeVerification`)のテスト。
 *
 * 見るのは、**製品の台帳が無くても・製品が何も採っていなくても(`uses: []`)Z3 が走る**こと(早期 return は製品の分だけを止める)、
 * 仕組みの根を渡していなければ未実施の行を返すこと、Z2 が仕組みの台帳の `planned` も言うこと。
 * 製品の木が無い(`available: false`)とき製品側の Z1 は何も見ないが、仕組みの孤児は出る。
 */

import { describe, expect, it } from 'vitest';
import { runGuaranteeVerification } from '../../../lib/guarantee/run.js';
import type { ScanWithFramework } from '../../../lib/testcase/types-scan-framework.js';
import type { FrameworkLedgerLoad } from '../../../lib/model/guarantee/framework-loader.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { annotation, scanResult } from '../../helpers/trace-builder.js';
import { specModel } from '../../helpers/model-builder.js';
import {
  frameworkGuaranteeModel,
  frameworkTestCase,
  guarantee,
  guaranteeModel,
} from '../../helpers/guarantee-builder.js';

const FW_FILE = 'framework/runtime/src/domain/__tests__/fire.test.ts';

/** 仕組みの台帳(保証 1 件・見張りテスト 1 件。planned の保証を足せる)。 */
function loaded(extra: readonly ReturnType<typeof guarantee>[] = []): FrameworkLedgerLoad {
  const model = frameworkGuaranteeModel([guarantee('fw_engine', { canaries: ['TC-FW-ENGINE-001'] }), ...extra], {
    testCases: [frameworkTestCase('TC-FW-ENGINE-001', `${FW_FILE}::遷移`)],
  });
  return { state: 'loaded', model, findings: [] };
}

/** 製品の台帳が無い(開設していない)モデル。 */
const NO_PRODUCT_LEDGER = guaranteeModel([], { available: false });

/** 製品の木が無い走査に、仕組みの根の走査(`FW_FILE` に注釈 1 件)を添えた結果。 */
function tests(annotations = [annotation({ tcId: 'TC-FW-ENGINE-001', file: FW_FILE, testName: '遷移' })]) {
  return {
    ...scanResult({ available: false }),
    framework: {
      state: { state: 'scanned' as const },
      testFiles: [FW_FILE],
      annotations,
      testBlocks: [{ file: FW_FILE, tcId: 'TC-FW-ENGINE-001', line: 1, readable: true, directAssertions: 1, directAssertionsOutsideLoop: 1, calls: [] }],
    },
  };
}

function run(framework: FrameworkLedgerLoad | undefined, scan: ScanWithFramework = tests(), product = NO_PRODUCT_LEDGER) {
  const registry = buildTcRegistry(
    collectTcEntries({ guarantees: product, frameworkGuarantees: framework?.state === 'loaded' ? framework.model : null }),
  );
  return runGuaranteeVerification({
    domain: specModel([]),
    guarantee: product,
    registry,
    tests: scan,
    ...(framework === undefined ? {} : { frameworkLedger: framework }),
  });
}

describe('runGuaranteeVerification', () => {
  it('製品の台帳が無くても Z3 は走り、仕組みの孤児を出す(製品側は available: false のまま)', () => {
    const orphan = annotation({ tcId: 'TC-FW-ORPHAN-001', file: FW_FILE, testName: '台帳に無い', line: 7 });
    const result = run(loaded(), tests([annotation({ tcId: 'TC-FW-ENGINE-001', file: FW_FILE, testName: '遷移' }), orphan]));

    expect(result.available).toBe(false);
    expect(result.testsAvailable).toBe(false);
    expect(result.findings.filter((f) => f.verifier === 'Z3')).toHaveLength(1);
    expect(result.findings.find((f) => f.verifier === 'Z3')?.message).toContain('TC-FW-ORPHAN-001');
  });

  it('製品の台帳が無く、仕組みの側が健全なら、緑のまま「突き合わせた」件数を返す', () => {
    const result = run(loaded());

    expect(result.findings).toEqual([]);
    expect(result.frameworkScanned).toBe(true);
    expect(result.frameworkGuaranteeCount).toBe(1);
    expect(result.frameworkMatched).toBe(1);
    expect(result.notes).toEqual([]);
  });

  it('仕組みの根を渡していなければ、未実施の行を返す(黙って緑にしない)', () => {
    const result = run(undefined, scanResult({ available: false }));

    expect(result.findings).toEqual([]);
    expect(result.frameworkScanned).toBe(false);
    expect(result.notes).toEqual([expect.stringMatching(/^Z3: 未実施 — /)]);
  });

  it('仕組みの台帳が阻害されていれば、製品の台帳の有無に依らず error', () => {
    const result = run({ state: 'blocked', reason: 'framework/guarantees.md がありません', findings: [] });

    expect(result.findings.some((f) => f.verifier === 'Z3' && f.severity === 'error')).toBe(true);
  });

  it('Z2 は仕組みの台帳の planned も毎回 warning で言う', () => {
    const planned = guarantee('fw_future', { status: 'planned', plannedReason: '着手待ち' });
    const result = run(loaded([planned]));

    const warnings = result.findings.filter((f) => f.verifier === 'Z2');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe('保証 fw_future はまだ執行されていない: 着手待ち');
  });
});
