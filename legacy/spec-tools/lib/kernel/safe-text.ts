/**
 * 仕様の文字列を**生成物の出口**(コメント・文字列リテラル・SQL の文字列)に置くときの無害化(kernel 層 — 全層が読む共通語)。
 *
 * 生成物の入力は信頼できない(敵対的な仕様の束がありうる)。仕様の文字列は、置く位置ごとに破れ方が違う ——
 * `//` と `--` の行コメントは**改行**で、`/* … *\/` は**閉じ記号**で、文字列リテラルは**引用符・バックスラッシュ・改行**で破れ、
 * `$$` で括った SQL の本文は**`$$`**で破れる。読み込み(`lib/io/front-matter.ts`)が制御文字と行の区切りを拒むが、**出口でも必ず無害化する**
 * (ファイルのパスは仕様の文字列ではなくファイルシステムの名前で、改行を含みうる。読み込みに頼らない二重の守り)。
 *
 * ここの関数は**正常な入力を 1 バイトも変えない**(生成物は入力から一意に定まり、鮮度の検査で比べられる)。変わるのは、
 * 位置を破る入力だけである。どの関数も例外を投げない。
 */

/** 行を終える文字(JavaScript の行コメントは U+2028 / U+2029 でも終わる。垂直タブ・改ページ・NEL も行の区切りとして扱う実装がある)。 */
const LINE_BREAKS = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/g;

/** 取り除く文字(NUL・その他の制御文字・向きを変える文字。見た目と中身を食い違わせる)。タブは残す。 */
const STRIPPED = /[\u0000-\u0008\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/**
 * 1 行にする(改行を空白 1 つにし、制御文字と向きを変える文字を取り除く)。
 *
 * @param text 仕様の文字列
 * @returns 改行を含まない文字列
 */
export function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, ' ').replace(STRIPPED, '');
}

/**
 * `/* … *\/` のコメントの本文に置ける形にする(1 行にし、閉じ記号 `*\/` を `*\\/` にする)。
 *
 * @param text 仕様の文字列
 */
export function blockCommentText(text: string): string {
  return oneLine(text).replace(/\*\//g, '*\\/');
}

/**
 * `//` の行コメントに置ける形にする(1 行にする)。
 *
 * @param text 仕様の文字列
 */
export function lineCommentText(text: string): string {
  return oneLine(text);
}

/**
 * SQL の `--` の行コメントに置ける形にする(1 行にする)。
 *
 * @param text 仕様の文字列
 */
export function sqlCommentText(text: string): string {
  return oneLine(text);
}

/**
 * TypeScript のシングルクォートの文字列リテラルにする。
 *
 * `\r\n` と `\n` は `\n` に畳み(従来の出力のまま)、単独の復帰・U+2028 / U+2029・その他の制御文字は `\r` / `\u2028` / `\xNN` に逃がす
 * (リテラルの中で行が終わると生成物が構文エラーになる)。
 *
 * @param value 生の値
 * @returns 引用符つきのリテラル
 */
export function tsStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, (char) => {
      if (char === '\r') return '\\r';
      if (char === '\u2028' || char === '\u2029') return `\\u${char.charCodeAt(0).toString(16)}`;
      return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
    });
  return `'${escaped}'`;
}

/**
 * SQL の文字列リテラル。単引用符は二重にする(標準準拠の文字列なのでバックスラッシュは文字そのもの)。
 *
 * **`$$` を含む値は Unicode エスケープの形(`U&'…'`)にする**: `$$` で括った関数の本文の中で `$$` が現れると本文がそこで終わるので、
 * `$` を `\0024` に逃がし(バックスラッシュは `\\`)、本文を破る並びを作らせない。`$` が 1 つだけの値(正規表現の末尾の `$` など)は従来の形のまま。
 * NUL は取り除く(Postgres は文字列に NUL を置けない)。
 *
 * @param value 生の値
 * @returns 引用符つきの SQL リテラル
 */
export function sqlStringLiteral(value: string): string {
  const clean = value.replace(/\u0000/g, '');
  if (!clean.includes('$$')) return `'${clean.split("'").join("''")}'`;
  const escaped = clean.split('\\').join('\\\\').split("'").join("''").split('$').join('\\0024');
  return `U&'${escaped}'`;
}
