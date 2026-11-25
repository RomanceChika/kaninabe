/**
 * コードの文字列リテラルのうち、**日本語を含むもの**を本文の行として取り出す純粋関数(用語の台帳の M9 が読むため)。
 *
 * コメントだけを読むと、**人に見えるメッセージ**(検査の違反文・生成器の出力文言・テストの題)に旧い綴りが
 * 書かれても検査に掛からない(ブック ①-d のレビューの実測: 人に見える文言の取りこぼしが 1 件あった)。
 * ひらがな・カタカナ・漢字を 1 文字でも含むリテラルは、人が読む文だと見なして走査に入れる。
 * 日本語を含まないリテラル(識別子・パス・キー・英語のラベル)は文ではないので読まない。
 *
 * **テストのファイルは題だけを読む。** `describe` / `it` / `test` の第 1 引数(人が読む題)は走査に入れ、
 * それ以外のリテラルは**テストの入力(フィクスチャ)と期待値**であって、旧い綴りが書かれるのは
 * 「旧い綴りを検査する」ためである(M9 自身のテストは旧い綴りを本文として渡す)。
 *
 * リテラルの切り出しは W1 と同じ道具(`stripComments` と `STRING_LITERAL`)を使う。
 */

import { STRING_LITERAL, stripComments } from '../generality/literals.js';
import { EXAMPLE_MARKS } from './prose.js';
import type { ProseLine } from '../model/terms/types.js';

/** ひらがな・カタカナ(長音を含む)・漢字・踊り字を 1 文字でも含むか。 */
const HAS_JAPANESE = /[ぁ-ヿ㐀-䶿一-鿿々]/u;

/** テストの題の直前(`describe(` / `it(` / `test(` と `.each` などの修飾)。リテラルの手前の文字で見る。 */
const TITLE_CALL = /\b(?:describe|it|test)(?:\.[A-Za-z]+)*\(\s*$/;

/** テストのファイルか(`__tests__` の下、または `*.test.*` / `*.spec.*`)。 */
export function isTestFile(file: string): boolean {
  return file.includes('/__tests__/') || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * ソースから、日本語を含む文字列リテラルの行を取り出す。
 *
 * 複数行のテンプレートリテラルは 1 行ずつに割る。行番号は元のファイルのもの(1 始まり)。
 *
 * @param source ソース全文
 * @param titlesOnly テストのファイルとして読む(題だけを取る)
 * @returns リテラルの中身の行(出現順。コメントは含まない)
 */
export function literalProseLines(source: string, titlesOnly: boolean): ProseLine[] {
  const code = stripComments(source);
  const lines: ProseLine[] = [];
  for (const match of code.matchAll(STRING_LITERAL)) {
    const inner = match[0].slice(1, -1);
    if (!HAS_JAPANESE.test(inner)) continue;
    const at = match.index ?? 0;
    if (titlesOnly && !TITLE_CALL.test(code.slice(Math.max(0, at - 32), at))) continue;
    const first = code.slice(0, at).split('\n').length;
    inner.split('\n').forEach((text, offset) => {
      lines.push({ line: first + offset, text, example: EXAMPLE_MARKS.some((mark) => text.includes(mark)) });
    });
  }
  return lines;
}
