/**
 * A16(注釈の中身)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「`@tc` の注釈を持つテストブロックは assert を 1 つ以上
 * 持ち、その assert がループの中だけに無いこと」。
 */

import { describe, expect, it } from 'vitest';
import { testAssertionsVerifier } from '../../../../lib/trace/verifiers/a16-test-assertions.js';
import { scanResult, testBlock, traceInput } from '../../../helpers/trace-builder.js';

describe('A16 注釈の中身', () => {
  it('assert が 1 つでもあれば通る', () => {
    const input = traceInput({ tests: scanResult({ testBlocks: [testBlock()] }) });

    expect(testAssertionsVerifier.verify(input)).toEqual([]);
  });

  it('assert が 1 つも無ければ error(何も確かめていないテストが見張りテストと数えられる)', () => {
    const input = traceInput({
      tests: scanResult({ testBlocks: [testBlock({ directAssertions: 0 })] }),
    });
    const findings = testAssertionsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A16');
    expect(findings[0]?.severity).toBe('error');
  });

  it('assert を含むヘルパを呼んでいれば通る(ヘルパ禁止という別の規則に化けさせない)', () => {
    const input = traceInput({
      tests: scanResult({
        testBlocks: [
          testBlock({
            directAssertions: 0,
            directAssertionsOutsideLoop: 0,
            calls: [
              { name: 'expectRejected', inLoop: false },
              { name: 'deps', inLoop: false },
            ],
          }),
        ],
        assertionHelpers: ['expectRejected'],
      }),
    });

    expect(testAssertionsVerifier.verify(input)).toEqual([]);
  });

  it('ヘルパでない関数を呼んでいるだけでは通らない', () => {
    const input = traceInput({
      tests: scanResult({
        testBlocks: [
          testBlock({
            directAssertions: 0,
            directAssertionsOutsideLoop: 0,
            calls: [{ name: 'deps', inLoop: false }],
          }),
        ],
        assertionHelpers: ['expectRejected'],
      }),
    });

    expect(testAssertionsVerifier.verify(input)).toHaveLength(1);
  });

  it('assert がループの中にしか無ければ warning(母集合が空の日に黙って緑になる)', () => {
    const input = traceInput({
      tests: scanResult({
        testBlocks: [testBlock({ directAssertions: 1, directAssertionsOutsideLoop: 0 })],
      }),
    });
    const findings = testAssertionsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('ヘルパ呼び出しがループの中にしか無ければ warning(2 段の空白を塞ぐ)', () => {
    const input = traceInput({
      tests: scanResult({
        testBlocks: [
          testBlock({
            directAssertions: 0,
            directAssertionsOutsideLoop: 0,
            calls: [{ name: 'expectCalls', inLoop: true }],
          }),
        ],
        assertionHelpers: ['expectCalls'],
      }),
    });
    const findings = testAssertionsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('構文を読めなかったブロックは中身を判定しないが、件数を warning で出す(黙らない)', () => {
    const input = traceInput({
      tests: scanResult({ testBlocks: [testBlock({ readable: false, directAssertions: 0 })] }),
    });
    const findings = testAssertionsVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('読めなかった');
  });

  it('app/ を読めない構成では何も見ない(A12 と同じ扱い)', () => {
    const input = traceInput({
      tests: scanResult({ available: false, testBlocks: [testBlock({ directAssertions: 0 })] }),
    });

    expect(testAssertionsVerifier.verify(input)).toEqual([]);
  });
});
