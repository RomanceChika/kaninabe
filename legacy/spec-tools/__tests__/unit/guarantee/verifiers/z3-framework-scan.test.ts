/**
 * Z3(仕組みの走査 ⇔ 仕組みの台帳)の規約網羅テスト。
 *
 * 対象の要求: 仕組み自身の見張りテストは、製品の `uses`・製品の台帳・action_spec・実装の木のどれにも依らず、
 * 仕組みの台帳と突き合う。**空の台帳や空の走査で緑にならない**(阻害は error・根を渡さないときは未実施と名指す)。
 * 否定のテスト(@tc の無いファイル・assert の無いテスト・根の外を指す宣言・根をまたぐ重複)を含む。
 */

import { describe, expect, it } from 'vitest';
import {
  frameworkNotRequestedNote,
  verifyFrameworkGuarantees,
} from '../../../../lib/guarantee/verifiers/z3-framework-scan.js';
import { isCheckRunNote } from '../../../../lib/verify/check-run-report.js';
import type { FrameworkLedgerLoad } from '../../../../lib/model/guarantee/framework-loader.js';
import type { FrameworkScan } from '../../../../lib/testcase/types-scan-framework.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { annotation, scanResult, testBlock } from '../../../helpers/trace-builder.js';
import {
  frameworkGuaranteeModel,
  frameworkTestCase,
  guarantee,
  guaranteeModel,
  guaranteeTestCase,
} from '../../../helpers/guarantee-builder.js';

const FW_FILE = 'framework/runtime/src/domain/engine/__tests__/fire.test.ts';
const FW_TC = 'TC-FW-ENGINE-001';
const FW_NAME = '許可なしでは遷移しない';

/** 仕組みの台帳(保証 1 件・見張りテスト 1 件)。 */
function ledger(file = FW_FILE, specIds: readonly string[] = ['framework-guarantee-catalog']): FrameworkLedgerLoad {
  const model = frameworkGuaranteeModel([guarantee('fw_engine', { canaries: [FW_TC] })], {
    testCases: [{ ...frameworkTestCase(FW_TC, `${file}::${FW_NAME}`), specIds }],
  });
  return { state: 'loaded', model, findings: [] };
}

/** 台帳(製品の台帳も渡せる)。仕組みの台帳は読込済みのときだけ載せる。 */
function registryOf(fw: FrameworkLedgerLoad, product = guaranteeModel([], { available: false })) {
  return buildTcRegistry(
    collectTcEntries({ guarantees: product, frameworkGuarantees: fw.state === 'loaded' ? fw.model : null }),
  );
}

/** 健全な仕組みの走査。 */
function fwScan(init: Partial<FrameworkScan> = {}): FrameworkScan {
  return {
    state: { state: 'scanned' },
    testFiles: [FW_FILE],
    annotations: [annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME })],
    halfTags: [],
    eachTags: [],
    testBlocks: [testBlock({ file: FW_FILE, tcId: FW_TC })],
    assertionHelpers: [],
    ...init,
  };
}

/** 製品の木が無い(`available: false`)走査に、仕組みの走査を添える。 */
function withFramework(framework: FrameworkScan | undefined, product = scanResult({ available: false })) {
  return framework === undefined ? product : { ...product, framework };
}

/** Z3 の違反を、仕組みの台帳とあわせて取る。 */
function run(
  framework: FrameworkScan | undefined,
  fw: FrameworkLedgerLoad = ledger(),
  product = scanResult({ available: false }),
) {
  return verifyFrameworkGuarantees(registryOf(fw), withFramework(framework, product), fw);
}

describe('Z3 仕組みの走査 ⇔ 仕組みの台帳', () => {
  it('台帳と走査が合っていれば、製品の木が無くても(available: false のまま)通る', () => {
    const tests = withFramework(fwScan());

    expect(tests.available).toBe(false);
    expect(run(fwScan())).toEqual([]);
  });

  it('製品の木が無くても、仕組みの注釈の孤児(台帳に宣言が無い @tc)を出す', () => {
    const orphan = annotation({ tcId: 'TC-FW-ORPHAN-001', file: FW_FILE, testName: '台帳に無い', line: 40 });
    const findings = run(fwScan({ annotations: [annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME }), orphan] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Z3');
    expect(findings[0]?.message).toContain('TC-FW-ORPHAN-001');
    expect(findings[0]?.location).toEqual({ file: FW_FILE, pointer: 'L40' });
  });

  it('仕組みの根のテストが製品の action_spec のテストケース ID を注釈に使っても、宣言とは認めず孤児にする', () => {
    const stolen = 'TC-ACTION-ENTRY-001';
    const productEntry = {
      tcId: stolen,
      specKind: 'action_spec' as const,
      specId: 'entry-submit',
      specIds: [],
      implementation: { raw: 'x.test.ts::提出', file: 'x.test.ts', testName: '提出' },
      location: { file: 'entry-submit.md' },
      specFile: 'entry-submit.md',
    };
    const fw = ledger();
    const registry = buildTcRegistry([...registryOf(fw).entries, productEntry]);
    const scan = fwScan({
      annotations: [
        annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME }),
        annotation({ tcId: stolen, file: FW_FILE, testName: '提出', line: 60 }),
      ],
    });

    const findings = verifyFrameworkGuarantees(registry, withFramework(scan), fw);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(stolen);
    expect(findings[0]?.message).toContain('どの保証台帳の test_cases にもありません');
  });

  it('製品の台帳が宣言している仕組みの根のテスト(製品の台帳に残した 1 件)は孤児にならない', () => {
    const productCase = { ...guaranteeTestCase('TC-GUAR-WIRING-001', `${FW_FILE}::配線`) };
    const product = guaranteeModel([guarantee('wiring', { canaries: ['TC-GUAR-WIRING-001'] })], { testCases: [productCase] });
    const fw = ledger();
    const registry = registryOf(fw, product);
    const scan = fwScan({
      annotations: [
        annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME }),
        annotation({ tcId: 'TC-GUAR-WIRING-001', file: FW_FILE, testName: '配線', line: 30 }),
      ],
      testBlocks: [testBlock({ file: FW_FILE, tcId: FW_TC }), testBlock({ file: FW_FILE, tcId: 'TC-GUAR-WIRING-001', line: 30 })],
    });

    expect(verifyFrameworkGuarantees(registry, withFramework(scan), fw)).toEqual([]);
  });

  describe('走査・台帳の状態', () => {
    it('根を渡していない(framework が無い / not_requested)ときは何も判定せず、未実施と名指す(黙って緑にしない)', () => {
      const notRequested: FrameworkScan = {
        state: { state: 'not_requested', reason: '仕組みの根が渡されていません' },
        testFiles: [],
        annotations: [],
      };
      const tests = withFramework(notRequested);

      expect(verifyFrameworkGuarantees(registryOf({ state: 'not_requested' }), tests, { state: 'not_requested' })).toEqual([]);
      const note = frameworkNotRequestedNote(tests, { state: 'not_requested' });
      expect(note).toBe('Z3: 未実施 — 仕組みの根が渡されていません(仕組み自身の見張りテストと保証台帳を突き合わせていません)。');
      expect(note !== null && isCheckRunNote(note)).toBe(true);
      expect(frameworkNotRequestedNote(withFramework(undefined), { state: 'not_requested' })).toBe(note);
    });

    it('根を渡して台帳も読めているときは未実施の行を出さない', () => {
      expect(frameworkNotRequestedNote(withFramework(fwScan()), ledger())).toBeNull();
    });

    it('走査が阻害されていれば、理由つきの error(空の走査で緑にならない)', () => {
      const blocked: FrameworkScan = {
        state: { state: 'blocked', reason: '仕組みの根の下にテストの置き場が 1 つもありません' },
        testFiles: [],
        annotations: [],
      };
      const findings = run(blocked);

      expect(findings.map((f) => f.verifier)).toContain('Z3');
      expect(findings.some((f) => f.message.includes('テストの置き場が 1 つもありません'))).toBe(true);
      expect(findings.every((f) => f.severity === 'error')).toBe(true);
    });

    it('台帳が阻害されていれば、理由つきの error', () => {
      const findings = run(fwScan(), { state: 'blocked', reason: '仕組みの台帳がありません', findings: [] });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('仕組みの台帳がありません');
      expect(findings[0]?.severity).toBe('error');
    });

    it('台帳を読めても見張りテストの宣言が 1 件も無ければ error(空の台帳で緑にならない)', () => {
      const empty: FrameworkLedgerLoad = { state: 'loaded', model: frameworkGuaranteeModel([guarantee('fw_none', { status: 'planned' })]), findings: [] };
      const findings = run(fwScan({ testFiles: [], annotations: [], testBlocks: [] }), empty);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('見張りテストの宣言(test_cases)が 1 件もありません');
    });

    it('台帳が阻害されていれば、走査を渡していなくても error(阻害は根を渡した証拠で、未実施にしない)', () => {
      const blocked: FrameworkLedgerLoad = { state: 'blocked', reason: '仕組みの台帳がありません', findings: [] };
      const tests = scanResult({ available: false });

      const findings = verifyFrameworkGuarantees(registryOf(blocked), tests, blocked);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('仕組みの台帳がありません');
      expect(frameworkNotRequestedNote(tests, blocked)).toBeNull();
    });

    it('台帳は読めたのに走査が渡されていなければ、配線の誤りとして error(未実施の行とは重ねない)', () => {
      const tests = scanResult({ available: false });

      const findings = verifyFrameworkGuarantees(registryOf(ledger()), tests, ledger());

      expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('走査が渡されていません')]);
      expect(frameworkNotRequestedNote(tests, ledger())).toBeNull();
    });

    it('走査は渡されているのに台帳が渡されていなければ、配線の誤りとして error', () => {
      const findings = run(fwScan(), { state: 'not_requested' });

      expect(findings.some((f) => f.message.includes('台帳が渡されていません'))).toBe(true);
      // 同じ原因を未実施の行と error の 2 本で言わない。
      expect(frameworkNotRequestedNote(withFramework(fwScan()), { state: 'not_requested' })).toBeNull();
    });
  });

  describe('仕組みの台帳の test_cases', () => {
    it('テストファイルが走査に無ければ、実在の違反(Z3)', () => {
      const findings = run(fwScan({ testFiles: [], annotations: [], testBlocks: [] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('Z3');
      expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
    });

    it('テスト名の食い違いを検出する', () => {
      const findings = run(fwScan({ annotations: [annotation({ tcId: FW_TC, file: FW_FILE, testName: '別の名前' })] }));

      expect(findings.some((f) => f.message.includes('テスト名が implementation と一致しません'))).toBe(true);
    });

    it('@tc の無いテストは uncovered として違反になる', () => {
      const findings = run(fwScan({ annotations: [] }));

      expect(findings.some((f) => f.message.includes('がテストコードにありません'))).toBe(true);
    });

    it('仕組みの根の外(製品の木)を指す宣言は error(仕組みの台帳が製品の木のテストを見張りにしない)', () => {
      const outside = 'app/src/infrastructure/__tests__/guarantees/rows.test.ts';
      const findings = run(fwScan(), ledger(outside));

      expect(findings.some((f) => f.message.includes('仕組みの見張りテストの置き場の外'))).toBe(true);
      expect(findings.find((f) => f.message.includes('置き場の外'))?.counterexample).toMatchObject({ file: outside });
    });

    it('spec_ids に製品のドメインの ID を書けない(仕組みが製品の語を持たない)', () => {
      const findings = run(fwScan(), ledger(FW_FILE, ['entry.submit']));

      expect(findings.some((f) => f.message.includes('spec_ids entry.submit は仕組みの台帳が指してよい仕様ではありません'))).toBe(true);
    });

    it('spec_ids に製品の台帳の id(guarantee-catalog)も書けない', () => {
      const findings = run(fwScan(), ledger(FW_FILE, ['guarantee-catalog']));

      expect(findings).toHaveLength(1);
    });
  });

  describe('仕組みの根の全注釈', () => {
    it('同じ @tc が仕組みの根の 2 つのテストにあれば重複', () => {
      const dup = annotation({ tcId: FW_TC, file: 'framework/runtime/src/other.test.ts', testName: FW_NAME, line: 3 });
      const findings = run(
        fwScan({
          testFiles: [FW_FILE, 'framework/runtime/src/other.test.ts'],
          annotations: [annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME }), dup],
          testBlocks: [testBlock({ file: FW_FILE, tcId: FW_TC }), testBlock({ file: dup.file, tcId: FW_TC })],
        }),
      );

      expect(findings.some((f) => f.message.includes('複数のテストに付いています'))).toBe(true);
    });

    it('同じ @tc が仕組みの根と製品の木にまたがってあれば重複(根をまたぐ重複は製品の注釈と合算して数える)', () => {
      const productSide = annotation({ tcId: FW_TC, file: 'app/src/operation/__tests__/x.test.ts', testName: FW_NAME, line: 9 });
      const product = scanResult({ testFiles: [productSide.file], annotations: [productSide] });
      const findings = run(fwScan(), ledger(), product);

      const dup = findings.filter((f) => f.message.includes('複数のテストに付いています'));
      expect(dup).toHaveLength(1);
      expect(dup[0]?.counterexample?.['places']).toContain('app/src/operation/__tests__/x.test.ts:9');
    });

    it('@tc を 1 つも持たない仕組みの根のテストファイルは error(未処理台帳は無い)', () => {
      const bare = 'framework/runtime/src/domain/__tests__/bare.test.ts';
      const findings = run(fwScan({ testFiles: [FW_FILE, bare] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(`${bare} は @tc の注釈を 1 つも持たない`);
      expect(findings[0]?.location).toEqual({ file: bare });
    });

    it('assert を 1 つも持たない注釈付きテストは error(Z3 の指摘として A16 と同じ判定)', () => {
      const findings = run(fwScan({ testBlocks: [testBlock({ file: FW_FILE, tcId: FW_TC, directAssertions: 0, calls: [] })] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('Z3');
      expect(findings[0]?.message).toContain('assert を 1 つも持ちません');
    });

    it('assert を含むヘルパを呼ぶだけでもよい(仕組みの根のハーネスが宣言する名前で許容する)', () => {
      const block = testBlock({ file: FW_FILE, tcId: FW_TC, directAssertions: 0, calls: [{ name: 'expectParity', inLoop: false }] });

      expect(run(fwScan({ testBlocks: [block], assertionHelpers: ['expectParity'] }))).toEqual([]);
    });

    it('片方だけの注釈(@spec だけの行)は error', () => {
      const findings = run(fwScan({ halfTags: [{ file: FW_FILE, line: 50, specIds: ['framework-guarantee-catalog'] }] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('片方だけの注釈');
    });

    it('テスト宣言の直前の行にない注釈は error', () => {
      const findings = run(
        fwScan({ annotations: [annotation({ tcId: FW_TC, file: FW_FILE, testName: FW_NAME, decorates: false })] }),
      );

      expect(findings.some((f) => f.message.includes('直前の行にありません'))).toBe(true);
    });

    it('ひな形とループの it の名前が食い違う @tc-each は error', () => {
      const findings = run(
        fwScan({ eachTags: [{ file: FW_FILE, line: 12, template: '{x} を確かめる', loopName: '{} を別の名前で確かめる' }] }),
      );

      expect(findings.some((f) => f.message.includes('ひな形がループの it の名前と食い違います'))).toBe(true);
    });
  });
});
