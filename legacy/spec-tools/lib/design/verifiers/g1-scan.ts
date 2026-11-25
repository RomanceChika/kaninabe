/**
 * G1 が値の中から「数値+単位」と「裸の識別子」を取り出すための走査(純粋関数)。
 *
 * `css-scan.ts` は 1 宣言(`property: value`)を取り出すところまでで止まる。ここから先
 * ―― 値の中の個々の数値・識別子を割り出す部分 ―― は G1 専用の走査であり、他の検証器
 * (G2・G3)には要らないため `css-scan.ts` に混ぜずここに置く。
 */

/** `rgb(...)` 等の色関数の呼び出し(名前 + 括弧の中身)。ネストした括弧は前提にしない。 */
const COLOR_FUNCTION_CALL = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi;

/** hex カラー。 */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

/** 数値(整数・小数・負号任意)+ 続く英字/`%` の単位(無ければ無単位)。 */
const DIMENSION = /(?<![\w.#-])(-?\d*\.?\d+)([a-zA-Z%]*)/g;

/** 先頭に `-` / `--` を許した CSS の識別子(トークン参照 `var(--color-canvas)` の中身も 1 語として拾う)。 */
const IDENT = /-{0,2}[a-zA-Z_][a-zA-Z0-9_-]*/g;

/** 数値 1 件の走査結果。 */
export interface DimensionMatch {
  /** マッチした全文(例: `16px` / `0` / `1.5`)。 */
  readonly text: string;
  /** 数値部分(例: `16` / `0` / `1.5`)。 */
  readonly number: string;
  /** 単位(無ければ空文字)。 */
  readonly unit: string;
}

/**
 * 色関数の呼び出しと hex カラーを空白で潰す。
 *
 * `rgba(0, 0, 0, 0.5)` のような呼び出しは、色そのものとしては既に 1 件の違反として
 * 報告済み(呼び出し元)なので、内部の `0` や `0.5` を別の「無単位のマジック値」として
 * 二重に報告しないための下ごしらえ。数値・識別子の走査はこの結果に対して行う。
 *
 * @param value CSS 宣言の値(文字列リテラルは呼び出し元で既に潰してある想定)
 * @returns 色関数呼び出しと hex を同じ長さの空白に置き換えた値
 */
export function maskColorSpans(value: string): string {
  return value.replace(COLOR_FUNCTION_CALL, blank).replace(HEX_COLOR, blank);
}

/** マッチした文字列と同じ長さの空白を作る(位置情報を崩さないため)。 */
function blank(match: string): string {
  return ' '.repeat(match.length);
}

/**
 * 値から数値(+ 単位)をすべて取り出す。
 *
 * トークン名の中の数字(`var(--space-4)` の `4`)は、直前が `-` になるため走査の対象外
 * ―― この関数は「独立した数値」だけを拾う(CSS の識別子の一部になっている数字は拾わない)。
 *
 * @param value 走査対象の値(`maskColorSpans` 済みが望ましい)
 * @returns 出現順の数値マッチ
 */
export function scanDimensions(value: string): readonly DimensionMatch[] {
  const found: DimensionMatch[] = [];
  for (const match of value.matchAll(DIMENSION)) {
    const number = match[1];
    const unit = match[2];
    if (number === undefined || unit === undefined) continue;
    found.push({ text: match[0], number, unit });
  }
  return found;
}

/**
 * 値から識別子(裸の単語)をすべて取り出す。
 *
 * `var(--color-canvas)` の `--color-canvas` は 1 語としてまとまって拾われるため、
 * その中の `canvas` だけを取り出して色名表と誤って照合することはない
 * (CSS の識別子はハイフンを含めて 1 つの語である)。
 *
 * @param value 走査対象の値(`maskColorSpans` 済みが望ましい)
 * @returns 出現順の識別子(前後の `--` を含んだ生の形)
 */
export function scanIdentifiers(value: string): readonly string[] {
  return [...value.matchAll(IDENT)].map((match) => match[0]);
}

/**
 * 識別子から比較用の裸の単語を作る(先頭の `--` を落として小文字化)。
 *
 * @param identifier `scanIdentifiers` が返した識別子
 * @returns 色名表 / システム色表と照合するための正規化済みの語
 */
export function bareWord(identifier: string): string {
  return identifier.replace(/^-+/, '').toLowerCase();
}

/**
 * 数値の文字列表現が厳密に 0 かどうか。
 *
 * @param number `DimensionMatch.number`(符号・小数点を含みうる)
 * @returns `0` / `-0` / `0.0` 等すべて true
 */
export function isZero(number: string): boolean {
  return Number.parseFloat(number) === 0;
}
