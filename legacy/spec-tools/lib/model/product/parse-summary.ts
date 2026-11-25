/**
 * 製品の宣言(`product.md`)の `summary`(製品が何かを 1 行で言う任意の欄)を読む純粋関数。
 *
 * **書いていなければ何も出さない。** 製品の名前などから文を作らず、既定の文も入れない(読み手には
 * 「仕様に言葉が無い」と見える方が、推測の文より正直である)。書いてあるのに受け付けない値は、
 * 黙って落とさず名指しの error にする(書いたのに効かない状態を作らない)。
 * 値は**文字列として扱う**。HTML・Markdown としては解釈しない(生成物の側でエスケープし、書き込みの出口で無害化する)。
 * 違反は例外ではなく Finding として積む(規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */

import type { SpecReporter } from '../parse-common.js';

/**
 * 長さの上限(字数。UTF-16 で 2 単位になる字も 1 字)。
 *
 * ハンドブックの 1 行は 40 字ほど(`max-width: 40em`)で、「誰が何をできる製品か」の 1 文は 2 行に収まる長さにする。
 * 集約の章頭の 1 文の目安は 50 字以内(domain-spec-writing.md §summary)で、製品の一言は集約をまたぐ分だけ少し長く取る。
 * 設計メモ(ハンドブックの設計の「製品の一言の欄」の節)の例の 80 字に従う。
 */
export const MAX_SUMMARY_LENGTH = 80;

/** 改行(CR・LF・NEL・行の区切り・段落の区切り)。値は 1 行で書く。 */
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/u;

/** 置けない文字: 制御文字(タブを含む)・DEL・C1 制御・零幅の文字・向きを変える文字・単語結合・BOM。書き込みの出口(write-gate)の拒否と同じ範囲。 */
const UNSAFE_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/** どう直すかの定型文。 */
const HOW =
  `summary は「誰が何をできる製品か」を、空でない 1 行の文字列で ${MAX_SUMMARY_LENGTH} 字以内に書く(敬体の 1 文。HTML・Markdown としては読まれない)。` +
  '書かないなら、キーごと消す(ブックには何も出ない。製品の名前などから文は作らない)';

/** 違反の文字を `U+000A` の形で名指す(文字そのものを出すと報告の行が壊れる)。 */
function codeOf(text: string): string {
  const match = UNSAFE_CHARACTER.exec(text);
  const code = match === null ? 0 : (match[0].codePointAt(0) ?? 0);
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * 宣言のフロントマターから製品の一言を取り出す。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先
 * @returns 書かれていて、受け付けた値。書かれていなければ undefined。受け付けない値も undefined(違反は積む)
 */
export function parseProductSummary(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): string | undefined {
  const value = data['summary'];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    reporter.error('summary', 'summary は文字列で書きます', HOW, { value: String(value) });
    return undefined;
  }
  if (value.trim() === '') {
    reporter.error('summary', 'summary が空です', HOW);
    return undefined;
  }
  if (LINE_BREAK.test(value)) {
    reporter.error('summary', 'summary に改行が含まれています(1 行で書きます)', HOW);
    return undefined;
  }
  if (UNSAFE_CHARACTER.test(value)) {
    reporter.error('summary', `summary に置けない文字(制御文字・零幅の文字・向きを変える文字。${codeOf(value)})が含まれています`, HOW);
    return undefined;
  }
  if (value !== value.trim()) {
    reporter.error('summary', 'summary の前後に空白があります', HOW);
    return undefined;
  }
  const length = Array.from(value).length;
  if (length > MAX_SUMMARY_LENGTH) {
    reporter.error('summary', `summary が長すぎます(${length} 字。上限は ${MAX_SUMMARY_LENGTH} 字)`, HOW);
    return undefined;
  }
  return value;
}
