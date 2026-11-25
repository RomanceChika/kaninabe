/**
 * 生成器がコードの柵(``` で囲む塊)を出すときの共通の口。
 *
 * ハンドブックの無害化は、仕様の文字列(登録されていない文字列)が行頭で柵を開くのを許さない(VitePress は柵の情報文字列の先頭の語を属性に**エスケープせずに**書くので、
 * 引用符を含む情報文字列が Vue のコンパイルを落とす)。生成器が出す柵は、登録簿に完全な形で登録して通す。
 * 柵は中身のバッククォートの連なりより長くする(中身の ``` が柵を閉じて、以降を Markdown として読ませない)。
 *
 * **アプリの語彙は 1 語も持たない**。
 */

import { trustSnippet } from '../../kernel/trusted-html.js';

/**
 * コードの柵を作って登録する。
 *
 * @param lang 情報文字列（生成器が書く定数。英数字・`_`・`-` だけ）
 * @param lines 中身の行
 * @returns 登録した柵つきの文字列
 */
export function fencedBlock(lang: string, lines: readonly string[]): string {
  const longest = Math.max(0, ...lines.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return trustSnippet([fence + lang, ...lines, fence].join('\n'));
}

/** 柵の開きの行（字下げは 3 まで。情報文字列は短い英数字だけ）。 */
const OPENING = /^ {0,3}(`{3,}|~{3,})([A-Za-z0-9_-]{0,20})[ \t]*$/;

/** 柵の閉じの行。 */
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * 引用する文章（仕様の本文）の中の、開きも閉じも揃ったコードの柵を、引用の記号つきの形で登録する。
 * 情報文字列が短い英数字でない柵・閉じない柵は登録しない（無害化が行頭の柵の記号を割るので、ただの文字として出る）。
 *
 * @param lines 引用する前の行
 * @param prefix 引用の記号（各行の頭に付けるもの）
 */
export function registerQuotedFences(lines: readonly string[], prefix: string): void {
  for (let index = 0; index < lines.length; index += 1) {
    const open = OPENING.exec(lines[index] ?? '');
    if (open === null) continue;
    const mark = open[1] ?? '```';
    for (let end = index + 1; end < lines.length; end += 1) {
      const close = CLOSING.exec(lines[end] ?? '');
      if (close !== null && (close[1] ?? '').charAt(0) === mark.charAt(0) && (close[1] ?? '').length >= mark.length) {
        trustSnippet(lines.slice(index, end + 1).map((line) => `${prefix}${line}`).join('\n'));
        index = end;
        break;
      }
    }
  }
}
