/**
 * A6(テスト突合)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「test_cases[].implementation が実在し、テスト側の @tc と
 * 双方向に一致する(仕様側に対応テストが無い = uncovered、テスト側に仕様の記載が無い = orphan)」。
 */

import { describe, expect, it } from 'vitest';
import { testTraceVerifier } from '../../../../lib/trace/verifiers/a6-test-trace.js';
import { SPEC_KIND_LIST } from '../../../../lib/testcase/types.js';
import {
  actionSpec,
  annotation,
  scanDecl,
  scanResult,
  testCase,
  traceInput,
} from '../../../helpers/trace-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';

const TEST_FILE = 'app/src/operation/__tests__/entry/submit.test.ts';
const TC = 'TC-ENTRY-SUBMIT-001';
const NAME = '下書きから提出できる';

/** TC-WORKSHOP-LIST-001 を宣言する query_spec(台帳に別仕様種を載せるため)。 */
function workshopList(file: string) {
  return querySpec({
    name: 'workshop_list',
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    testCases: [
      testCase({ id: 'TC-WORKSHOP-LIST-001', implementation: `${file}::${NAME}`, type: 'integration' }),
    ],
  });
}

/** 仕様側 1 件 + テスト側 1 件が揃った入力を作る(各テストで一部だけ崩す)。 */
function matched(overrides: {
  implementation?: string;
  annotationFile?: string;
  annotationName?: string | null;
  annotationTc?: string;
  specIds?: readonly string[];
  annotationSpecIds?: readonly string[];
  testFiles?: readonly string[];
} = {}) {
  return traceInput({
    actions: [
      actionSpec({
        handles: 'entry.submit',
        testCases: [
          testCase({
            id: TC,
            implementation: overrides.implementation ?? `${TEST_FILE}::${NAME}`,
            ...(overrides.specIds === undefined ? {} : { specIds: overrides.specIds }),
          }),
        ],
      }),
    ],
    tests: scanResult({
      testFiles: overrides.testFiles ?? [TEST_FILE],
      annotations: [
        annotation({
          tcId: overrides.annotationTc ?? TC,
          file: overrides.annotationFile ?? TEST_FILE,
          testName: overrides.annotationName === undefined ? NAME : overrides.annotationName,
          ...(overrides.annotationSpecIds === undefined
            ? {}
            : { specIds: overrides.annotationSpecIds }),
        }),
      ],
    }),
  });
}

describe('A6 テスト突合', () => {
  it('パス・@tc・テスト名がすべて一致すれば通る', () => {
    expect(testTraceVerifier.verify(matched())).toEqual([]);
  });

  it('implementation のテストファイルが存在しないと違反になる', () => {
    const findings = testTraceVerifier.verify(matched({ testFiles: [] }));

    expect(findings.some((f) => f.message.includes('テストファイルがありません'))).toBe(true);
  });

  it('uncovered: 仕様に書いた @tc がテストコードに無いと違反になる', () => {
    const input = traceInput({
      actions: [
        actionSpec({
          handles: 'entry.submit',
          testCases: [testCase({ id: TC, implementation: `${TEST_FILE}::${NAME}` })],
        }),
      ],
      tests: scanResult({ testFiles: [TEST_FILE] }),
    });

    const findings = testTraceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A6');
    expect(findings[0]?.message).toContain(`"@tc ${TC}" がテストコードにありません`);
  });

  it('orphan: テストの @tc が仕様に無いと違反になる', () => {
    const input = traceInput({
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [annotation({ tcId: 'TC-ENTRY-SUBMIT-999', file: TEST_FILE, testName: NAME })],
      }),
    });

    const findings = testTraceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    // 仕様種の並びは台帳(SPEC_KIND_LIST)から導く。ここに文字列を書き写すと、
    // 仕様種が増えたときにメッセージだけが古くなっても誰も気づかない。
    expect(findings[0]?.message).toContain(
      `どの仕様(${SPEC_KIND_LIST.join(' / ')})の test_cases にもありません`,
    );
  });

  it('別の仕様が宣言した @tc でも、複数のテストに付いていれば重複として検出する', () => {
    const other = 'app/src/composition/__tests__/entry/submit.test.ts';
    const input = traceInput({
      queries: [workshopList(TEST_FILE)],
      tests: scanResult({
        testFiles: [TEST_FILE, other],
        annotations: [
          annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: TEST_FILE, testName: NAME }),
          annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: other, testName: NAME }),
        ],
      }),
    });

    const findings = testTraceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('が複数のテストに付いています');
  });

  it('orphan: 別の仕様(query_spec)が宣言した @tc は orphan にしない', () => {
    const input = traceInput({
      queries: [workshopList(TEST_FILE)],
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [
          annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: TEST_FILE, testName: NAME }),
        ],
      }),
    });

    expect(testTraceVerifier.verify(input)).toEqual([]);
  });

  it('orphan: scans[].test_cases(A10 のテスト義務)が宣言した @tc も orphan にしない', () => {
    const tc = testCase({ id: 'TC-ENTRY-CLOSE-001', implementation: `${TEST_FILE}::${NAME}` });
    const input = traceInput({
      scans: [scanDecl('entry.close', 'app/src/operation/entry/close.ts', [tc])],
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [annotation({ tcId: 'TC-ENTRY-CLOSE-001', file: TEST_FILE, testName: NAME })],
      }),
    });

    // A10 が別途この注釈を突合するので、A6 は素通しする(重複報告を避ける)。
    expect(testTraceVerifier.verify(input)).toEqual([]);
  });

  it('テスト名が implementation と食い違うと違反になる', () => {
    const findings = testTraceVerifier.verify(matched({ annotationName: '別のテスト名' }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ spec_side: NAME, test_side: '別のテスト名' });
  });

  it('アノテーションが別ファイルにあると違反になる', () => {
    const other = 'app/src/composition/__tests__/entry/submit.test.ts';
    const findings = testTraceVerifier.verify(
      matched({ annotationFile: other, testFiles: [TEST_FILE, other] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['found_in']).toBe(other);
  });

  it('アノテーションが飾るテストを特定できないと違反になる', () => {
    const findings = testTraceVerifier.verify(matched({ annotationName: null }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('特定できません');
  });

  it('同じ @tc が複数のテストに付いていると違反になる', () => {
    const input = traceInput({
      actions: [
        actionSpec({
          handles: 'entry.submit',
          testCases: [testCase({ id: TC, implementation: `${TEST_FILE}::${NAME}` })],
        }),
      ],
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [
          annotation({ tcId: TC, file: TEST_FILE, testName: NAME, line: 10 }),
          annotation({ tcId: TC, file: TEST_FILE, testName: NAME, line: 20 }),
        ],
      }),
    });

    const findings = testTraceVerifier.verify(input);

    expect(findings.some((f) => f.message.includes('複数のテストに付いています'))).toBe(true);
    // 対処では宣言元を仕様種つきで示す(仕様種の決め打ちをしない)。
    expect(findings[0]?.counterexample?.['declared_in']).toBe('action_spec entry-submit-action');
  });

  it('spec_ids とテスト側 @spec の食い違いは警告にとどまる', () => {
    const findings = testTraceVerifier.verify(
      matched({ specIds: ['entry.submit'], annotationSpecIds: ['INV-ENTRY-001'] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('境界: @spec を書いていないアノテーションは spec_ids の突合をしない', () => {
    expect(testTraceVerifier.verify(matched({ annotationSpecIds: [] }))).toEqual([]);
  });

  it('境界: app/ を走査できない環境では何も検証しない', () => {
    const input = traceInput({
      actions: [
        actionSpec({
          handles: 'entry.submit',
          testCases: [testCase({ id: TC, implementation: `${TEST_FILE}::${NAME}` })],
        }),
      ],
      tests: scanResult({ available: false }),
    });

    expect(testTraceVerifier.verify(input)).toEqual([]);
  });
});
