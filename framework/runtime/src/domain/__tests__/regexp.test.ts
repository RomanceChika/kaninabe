/**
 * `escapeRegExp`(正規表現に入れる値の特殊文字のエスケープ。ASVS V1.2.9)のテスト。
 *
 * 基準: 特殊文字 1 つずつの表と、「エスケープした値は元の文字列にだけ一致する」性質(敵対的な値を含む)。
 */

import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../regexp';

/** 特殊文字 1 つずつ(入力 → エスケープ後)。 */
const SPECIALS: ReadonlyArray<readonly [string, string]> = [
  ['\\', '\\\\'],
  ['^', '\\^'],
  ['$', '\\$'],
  ['.', '\\.'],
  ['*', '\\*'],
  ['+', '\\+'],
  ['?', '\\?'],
  ['(', '\\('],
  [')', '\\)'],
  ['[', '\\['],
  [']', '\\]'],
  ['{', '\\{'],
  ['}', '\\}'],
  ['|', '\\|'],
  ['/', '\\/'],
  ['-', '\\x2d'],
];

describe('escapeRegExp: 特殊文字を文字そのものに一致させる', () => {
  it.each(SPECIALS)('%s をエスケープする', (input, expected) => {
    expect(escapeRegExp(input)).toBe(expected);
  });

  it('特殊文字でない文字はそのまま(日本語・英数字・空文字)', () => {
    expect(escapeRegExp('abc123_日本語')).toBe('abc123_日本語');
    expect(escapeRegExp('')).toBe('');
  });

  // @spec framework-guarantee-catalog @tc TC-FW-REGEXP-001
  it('エスケープした値は、元の文字列にだけ全体一致する(敵対的な値を含む)', () => {
    const hostile = ['a.b', '(a+)+$', '[a-z]*', '.*', 'a|b', '^x$', '\\d', '{1,99}', 'a-b', '漢[字]'];
    for (const value of hostile) {
      for (const flags of ['', 'u']) {
        const pattern = new RegExp(`^${escapeRegExp(value)}$`, flags);
        expect(pattern.test(value), value).toBe(true);
        expect(pattern.test(`${value}x`), value).toBe(false);
        expect(pattern.test(`x${value}`), value).toBe(false);
      }
    }
    // `.` が任意の 1 文字に化けない。
    expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
  });

  it('文字クラスの中でも範囲に化けない(`-`)', () => {
    const pattern = new RegExp(`^[${escapeRegExp('a-z')}]+$`, 'u');
    expect(pattern.test('a-z')).toBe(true);
    expect(pattern.test('b')).toBe(false);
  });
});
