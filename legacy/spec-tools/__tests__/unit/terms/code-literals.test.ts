/**
 * コードの文字列リテラル(日本語を含むもの)の取り出しのテスト。
 *
 * 規約網羅(term-ledger-writing.md §走査の範囲): 人に見えるメッセージの旧綴りを検査の範囲に入れるため、
 * ひらがな・カタカナ・漢字を 1 文字でも含むリテラルを読む。識別子・パス・英語のラベルは読まない。
 * テストのファイルは題(describe / it / test の第 1 引数)だけを読む。
 */

import { describe, expect, it } from 'vitest';
import { isTestFile, literalProseLines } from '../../../lib/terms/code-literals.js';

/** (行番号, 文字) の対。 */
function literals(source: string, titlesOnly = false): readonly (readonly [number, string])[] {
  return literalProseLines(source, titlesOnly).map((line) => [line.line, line.text]);
}

describe('literalProseLines: 読むリテラル', () => {
  it('日本語を含む 3 種類のリテラルを行番号つきで読む', () => {
    const source = "const a = 'ひらがな';\nconst b = \"カタカナ\";\nconst c = `漢字 ${x}`;\n";

    expect(literals(source)).toEqual([
      [1, 'ひらがな'],
      [2, 'カタカナ'],
      [3, '漢字 ${x}'],
    ]);
  });

  it('1 文字でも日本語を含めば読む(英語の文の中の 1 字も)', () => {
    expect(literals("fail('rule X: 語 is missing');\n")).toEqual([[1, 'rule X: 語 is missing']]);
  });

  it('複数行のテンプレートは 1 行ずつに割り、行番号は元のもの', () => {
    expect(literals('const s = `一行目\n二行目`;\n')).toEqual([
      [1, '一行目'],
      [2, '二行目'],
    ]);
  });

  it('`例:` のある行に例示の印を付ける', () => {
    const lines = literalProseLines("m('旧綴り(例: ゲート)');\nm('普通の文');\n", false);

    expect(lines.map((line) => line.example)).toEqual([true, false]);
  });
});

describe('literalProseLines: 読まないリテラル', () => {
  it('日本語を含まないリテラル(識別子・パス・キー・英語のラベル)は読まない', () => {
    expect(literals("const a = 'plain'; const b = \"a/b.ts\"; const c = `key_${x}`;\n")).toEqual([]);
  });

  it('コメントの中の引用符は読まない(コメントは別の口が読む)', () => {
    expect(literals("// 'コメントの中'\n/* \"ここも\" */\nconst a = 1;\n")).toEqual([]);
  });

  it('URL を含む文字列の後ろのコードを散文にしない', () => {
    expect(literals("const u = 'https://example.com/x'; const m = '日本語';\n")).toEqual([[1, '日本語']]);
  });
});

describe('literalProseLines: テストのファイルは題だけ', () => {
  const source = [
    "describe('題 A', () => {",
    "  it('題 B', () => {",
    "    run('入力');",
    "    expect(x).toBe('期待値');",
    '  });',
    "  it.each([1])('題 C', () => {});",
    "  test.skip('題 D', () => {});",
    '});',
    '',
  ].join('\n');

  it('describe / it / test(とその修飾)の第 1 引数だけを読む', () => {
    expect(literals(source, true)).toEqual([
      [1, '題 A'],
      [2, '題 B'],
      [7, '題 D'],
    ]);
  });

  it('it.each の題は、修飾つきの呼び出しの 2 つ目の括弧なので読まない(既知の取りこぼし)', () => {
    expect(literals(source, true).map(([, text]) => text)).not.toContain('題 C');
  });

  it('titlesOnly でなければ全部読む', () => {
    expect(literals(source, false).map(([, text]) => text)).toEqual(['題 A', '題 B', '入力', '期待値', '題 C', '題 D']);
  });
});

describe('isTestFile', () => {
  it('__tests__ の下と *.test.* / *.spec.* はテスト、それ以外は違う', () => {
    expect(isTestFile('legacy/spec-tools/__tests__/unit/a.ts')).toBe(true);
    expect(isTestFile('app/src/a.test.ts')).toBe(true);
    expect(isTestFile('app/e2e/a.spec.mts')).toBe(true);
    expect(isTestFile('app/src/a.ts')).toBe(false);
    expect(isTestFile('app/src/latest.ts')).toBe(false);
  });
});
