/**
 * A12(注釈の台帳)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「`@tc` の注釈を 1 つも持たないテストファイルは、
 * 既知の未処理台帳(`test_tag_baseline`)に載っているものに限る」(ラチェット)。
 */

import { describe, expect, it } from 'vitest';
import { untaggedTestsVerifier } from '../../../../lib/trace/verifiers/a12-untagged-tests.js';
import { annotation, halfTag, scanResult, testTagBaseline, traceInput } from '../../../helpers/trace-builder.js';

const TAGGED = 'app/src/operation/__tests__/entry/submit.test.ts';
const UNTAGGED = 'app/src/domain/__tests__/engine/machine.test.ts';

/** 注釈ありが 1 本・無印が 1 本の走査結果。 */
function scanned(extra: Parameters<typeof scanResult>[0] = {}) {
  return scanResult({
    testFiles: [TAGGED, UNTAGGED],
    annotations: [annotation({ tcId: 'TC-ENTRY-SUBMIT-001', file: TAGGED })],
    ...extra,
  });
}

describe('A12 ひな形の注釈(@tc-each)の接地', () => {
  /** ひな形 1 件を持つ走査結果。 */
  function withEach(template: string, loopName: string | null) {
    return scanResult({
      testFiles: [TAGGED],
      annotations: [annotation({ tcId: 'TC-ENTRY-SUBMIT-001', file: TAGGED })],
      eachTags: [{ file: TAGGED, line: 12, template, loopName }],
    });
  }

  it('ひな形がループの it の名前と同じ形なら通る', () => {
    const input = traceInput({ tests: withEach('{table} の突合', '{} の突合') });
    expect(untaggedTestsVerifier.verify(input)).toEqual([]);
  });

  it('ひな形がループの it の名前と食い違えば error(突合が静かに空になる)', () => {
    const findings = untaggedTestsVerifier.verify(
      traceInput({ tests: withEach('{table} の突合', '{} の別の名前') }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A12');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample).toMatchObject({ template: '{} の突合', loop: '{} の別の名前' });
  });

  it('ひな形の直後にテスト宣言が無ければ error', () => {
    const findings = untaggedTestsVerifier.verify(traceInput({ tests: withEach('{table} の突合', null) }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('直後にテスト宣言がありません');
  });
});

describe('A12 注釈の台帳', () => {
  it('無印のファイルが台帳に載っていれば通る(既知の未処理)', () => {
    const input = traceInput({
      tests: scanned(),
      testTagBaseline: [testTagBaseline(UNTAGGED)],
    });

    expect(untaggedTestsVerifier.verify(input)).toEqual([]);
  });

  it('台帳に無い無印のファイルは違反になる(新規の無印 = ラチェットの破り)', () => {
    const findings = untaggedTestsVerifier.verify(traceInput({ tests: scanned() }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A12');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location.file).toBe(UNTAGGED);
    expect(findings[0]?.counterexample).toMatchObject({ file: UNTAGGED });
  });

  it('注釈が 1 つでもあるファイルは対象外(粒度はファイル単位)', () => {
    const input = traceInput({
      tests: scanResult({
        testFiles: [TAGGED],
        annotations: [annotation({ tcId: 'TC-ENTRY-SUBMIT-001', file: TAGGED })],
      }),
    });

    expect(untaggedTestsVerifier.verify(input)).toEqual([]);
  });

  it('注釈が付いたのに台帳に残っている行は消し込み漏れの警告になる', () => {
    const findings = untaggedTestsVerifier.verify(
      traceInput({
        tests: scanned(),
        testTagBaseline: [testTagBaseline(UNTAGGED), testTagBaseline(TAGGED)],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('注釈が付いたのに');
    expect(findings[0]?.counterexample).toMatchObject({ file: TAGGED });
  });

  it('実在しないファイルを指す行は警告になる(移動・削除の追随漏れ)', () => {
    const gone = 'app/src/domain/__tests__/engine/removed.test.ts';
    const findings = untaggedTestsVerifier.verify(
      traceInput({
        tests: scanned(),
        testTagBaseline: [testTagBaseline(UNTAGGED), testTagBaseline(gone)],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('存在しない');
    expect(findings[0]?.counterexample).toMatchObject({ file: gone });
  });

  it('app/ を走査できない構成では何も言わない(A2 の実装側と同じ扱い)', () => {
    const input = traceInput({
      tests: scanResult({ available: false, testFiles: [UNTAGGED] }),
    });

    expect(untaggedTestsVerifier.verify(input)).toEqual([]);
  });

  it('@spec はあるが @tc が無い行(片方だけの注釈)は台帳に載っていてもエラーになる', () => {
    const input = traceInput({
      tests: scanned({ halfTags: [halfTag({ file: TAGGED, specIds: ['entry.submit'], line: 5 })] }),
      testTagBaseline: [testTagBaseline(UNTAGGED)],
    });

    const findings = untaggedTestsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A12');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('片方だけの注釈');
    expect(findings[0]?.location).toEqual({ file: TAGGED, pointer: 'L5' });
    expect(findings[0]?.counterexample).toMatchObject({ file: TAGGED, line: '5', spec: 'entry.submit' });
  });

  it('テスト宣言の直前の行に無い注釈は error(1 行下げるだけで A16 を外せる形を塞ぐ)', () => {
    const input = traceInput({
      tests: scanResult({
        testFiles: [TAGGED],
        annotations: [
          annotation({ tcId: 'TC-ENTRY-SUBMIT-001', file: TAGGED, line: 7, decorates: false }),
        ],
      }),
    });
    const findings = untaggedTestsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('直前の行');
    expect(findings[0]?.location).toEqual({ file: TAGGED, pointer: 'L7' });
  });

  it('Finding は 3 点セット(message / location / suggestion)を必ず持つ', () => {
    const findings = untaggedTestsVerifier.verify(
      traceInput({
        tests: scanned(),
        testTagBaseline: [testTagBaseline('app/src/domain/__tests__/engine/removed.test.ts')],
      }),
    );

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.message).not.toBe('');
      expect(finding.suggestion).not.toBe('');
      expect(finding.location.file).not.toBe('');
    }
  });
});
