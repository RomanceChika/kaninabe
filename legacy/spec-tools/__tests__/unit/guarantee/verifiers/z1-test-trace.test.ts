/**
 * Z1(テスト突合)の規約網羅テスト。
 * 対象の要求: guarantee-spec-writing.md「test_cases[].implementation が実在し、テスト側の
 * @tc と一致する」。突合そのものは H3 / A6 / Q6 と共通実装(lib/testcase/test-trace-match.ts)
 * なので、ここでは Z1 として動くこと・spec_ids の実在(ドメイン ID + guarantee-catalog)を見る。
 */

import { describe, expect, it } from 'vitest';
import { verifyGuaranteeTestTrace } from '../../../../lib/guarantee/verifiers/z1-test-trace.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { annotation, scanResult } from '../../../helpers/trace-builder.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder.js';
import {
  frameworkGuaranteeModel,
  guarantee,
  guaranteeModel,
  guaranteeTestCase,
} from '../../../helpers/guarantee-builder.js';
import type { FrameworkScan } from '../../../../lib/testcase/types-scan-framework.js';

const TEST_FILE = 'app/src/infrastructure/__tests__/guarantees/rows.test.ts';
const TC = 'TC-GUAR-ROWS-001';
const NAME = '行が返らない';

/** 台帳を保証台帳だけから構築する。 */
function registryOf(model: ReturnType<typeof guaranteeModel>) {
  return buildTcRegistry(collectTcEntries({ guarantees: model }));
}

/** 標準的な入力(1 保証 + それを指す 1 テストケース)。 */
function standard(specIds: readonly string[] = ['guarantee-catalog']) {
  return guaranteeModel([guarantee('rows_by_rls', { canaries: [TC] })], {
    testCases: [{ ...guaranteeTestCase(TC, `${TEST_FILE}::${NAME}`), specIds }],
  });
}

describe('Z1 テスト突合', () => {
  it('実在するテストに @tc が付いていれば通る', () => {
    const findings = verifyGuaranteeTestTrace(
      specModel([]),
      registryOf(standard()),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings).toEqual([]);
  });

  it('テストファイルが無ければ Z1 の違反になる', () => {
    const findings = verifyGuaranteeTestTrace(specModel([]), registryOf(standard()), scanResult({ testFiles: [] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Z1');
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
  });

  it('@tc が無いテストは uncovered として違反になる', () => {
    const findings = verifyGuaranteeTestTrace(specModel([]), registryOf(standard()), scanResult({ testFiles: [TEST_FILE] }));

    expect(findings.some((f) => f.message.includes('がテストコードにありません'))).toBe(true);
  });

  it('テスト名の食い違いを検出する', () => {
    const findings = verifyGuaranteeTestTrace(
      specModel([]),
      registryOf(standard()),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: '別の名前' })] }),
    );

    expect(findings.some((f) => f.message.includes('テスト名が implementation と一致しません'))).toBe(true);
  });

  it('spec_ids が実在しない ID を指すと違反になる', () => {
    const findings = verifyGuaranteeTestTrace(
      specModel([]),
      registryOf(standard(['nowhere.event'])),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings.map((f) => f.message)).toContain(`${TC} の spec_ids nowhere.event に対応する仕様がありません`);
  });

  it('spec_ids にはドメインイベント ID も書ける', () => {
    const domain = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted' })],
          }),
        ],
      }),
    ]);
    const findings = verifyGuaranteeTestTrace(
      domain,
      registryOf(standard(['entry.submit'])),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings).toEqual([]);
  });

  it('app/ を走査できていなくても、宣言だけで分かる検査(spec_ids)は行う', () => {
    const findings = verifyGuaranteeTestTrace(
      specModel([]),
      registryOf(standard(['nowhere.event'])),
      scanResult({ available: false }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('spec_ids nowhere.event に対応する仕様がありません');
  });

  describe('仕組みの見張りテストの置き場の下を指す、製品の台帳のエントリ', () => {
    const FW_FILE = 'legacy/spec-tools/__tests__/guarantees/wiring.test.ts';
    const WIRING_TC = 'TC-GUAR-WIRING-001';
    const wiring = guaranteeModel([guarantee('wiring', { canaries: [WIRING_TC] })], {
      testCases: [guaranteeTestCase(WIRING_TC, `${FW_FILE}::配線`)],
    });
    const fwScan = (init: Partial<FrameworkScan> = {}): FrameworkScan => ({
      state: { state: 'scanned' },
      testFiles: [FW_FILE],
      annotations: [annotation({ tcId: WIRING_TC, file: FW_FILE, testName: '配線' })],
      ...init,
    });

    it('仕組みの根を渡していれば、製品の走査ではなく仕組みの走査を引いて通る(製品の木が無くてもよい)', () => {
      const tests = { ...scanResult({ available: false }), framework: fwScan() };

      expect(verifyGuaranteeTestTrace(specModel([]), registryOf(wiring), tests)).toEqual([]);
    });

    it('仕組みの走査に @tc が無ければ、製品の走査にあっても違反(渡している間は仕組みの走査が正)', () => {
      const tests = {
        ...scanResult({ testFiles: [FW_FILE], annotations: [annotation({ tcId: WIRING_TC, file: FW_FILE, testName: '配線' })] }),
        framework: fwScan({ annotations: [] }),
      };

      const findings = verifyGuaranteeTestTrace(specModel([]), registryOf(wiring), tests);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('がテストコードにありません');
    });

    it('仕組みの根を渡していなければ、製品の走査は置き場を読まないので何も見ない(未実施は Z3 が言う。「ファイルが無い」と偽らない)', () => {
      const tests = scanResult({ testFiles: [], annotations: [] });

      expect(verifyGuaranteeTestTrace(specModel([]), registryOf(wiring), tests)).toEqual([]);
    });

    it('仕組みの走査が阻害されていれば、ここでは何も言わない(阻害は Z3 が言う)', () => {
      const blocked = fwScan({ state: { state: 'blocked', reason: '置き場が無い' }, testFiles: [], annotations: [] });
      const tests = { ...scanResult({ testFiles: [], annotations: [] }), framework: blocked };

      expect(verifyGuaranteeTestTrace(specModel([]), registryOf(wiring), tests)).toEqual([]);
    });

    it('仕組みの台帳のエントリは Z1 の対象ではない(Z3 が見る)', () => {
      const fw = frameworkGuaranteeModel([guarantee('fw_engine', { canaries: ['TC-FW-ENGINE-001'] })]);
      const registry = buildTcRegistry(collectTcEntries({ frameworkGuarantees: fw }));

      expect(verifyGuaranteeTestTrace(specModel([]), registry, scanResult({ testFiles: [] }))).toEqual([]);
    });
  });
});
