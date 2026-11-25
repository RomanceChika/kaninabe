/**
 * ソースから**字句を取り出す**純関数(コメントを潰す・型別名の union を集める・リテラルを拾う)。
 *
 * 木を歩く `scan.ts`(入口は `scanVocabularyLiterals()`)が読んだ本文から字句を取り出す側で、
 * TLA の字句規則(`\\*` の行コメント)もここが持つ。
 */

import { readFileSync } from 'node:fs';

/**
 * コメントの範囲(開始と終了のオフセット)を**前から 1 回の走査で**求める。
 *
 * **W1(リテラル)と W2(散文)が同じ 1 つの走査器を使う。** 正規表現を 2 回当てる形は、どちらの
 * 順でも誤検出を作る(束 ①-c-c のレビューが W1 側に残っていた 2 つを実測):
 *   - 行コメントを先に落とすと、**ブロックの中の `//` が閉じの `*​/` を食べ**てブロックが伸びる
 *   - ブロックを先に取ると、**行コメントの中の `/**` が偽のブロックを開く**
 *   - **文字列の中の `//`**(URL)は行コメントに見える
 *   - **正規表現リテラルの中の引用符**(`` /[`]/ ``)は文字列を開き、改行を越えて居座る
 *
 * 状態は 6 つ(コード・行コメント・ブロックコメント・`'`・`"`・backtick・正規表現)。正規表現の
 * 開始は「直前の**有意な**文字が `(`・`,`・`=`・`:`・`[`・`!`・`&`・`|`・`?`・`{`・`;`・`>`・`+`・
 * `*`・`%`・`-`・`~`・`^` のいずれか、または行頭」という簡易規則で見分ける —— 割り算の `/` の
 * あとには識別子・数値・`)`・`]` が来るので、この規則で取り違えない。**射程はこの木のコード**
 * (`legacy/spec-tools` と `framework/**`)であり、`a++ / b` のような病的な形は見ない。
 *
 * @param source ソース全文
 * @returns コメントの範囲(開始は `//` / `/*` の位置、終了はその次の文字の位置)
 */
export function commentRanges(source: string): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex' = 'code';
  let start = 0;
  let lastSignificant = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (state === 'line') {
      if (char === '\n') {
        ranges.push({ start, end: i });
        state = 'code';
      }
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        ranges.push({ start, end: i + 2 });
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state !== 'code') {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === '\n' && state !== 'template') state = 'code';
      else if (CLOSE_OF[state] === char) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line';
      start = i;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      start = i;
      i += 1;
      continue;
    }
    if (char === '/' && REGEX_PRECEDING.has(lastSignificant)) {
      state = 'regex';
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '`') state = 'template';
    if (char.trim() !== '') lastSignificant = char;
  }
  if (state === 'line' || state === 'block') ranges.push({ start, end: source.length });
  return ranges;
}

/** 文字列・正規表現の状態と、その閉じ記号。 */
const CLOSE_OF: Readonly<Record<string, string>> = {
  single: "'",
  double: '"',
  template: '`',
  regex: '/',
};

/**
 * この文字の直後の `/` は**正規表現の開始**である(空文字 = 行頭・ファイル頭)。
 *
 * 割り算の `/` の前には識別子・数値・`)`・`]` が来るので、その集合の補集合で十分である。
 */
const REGEX_PRECEDING = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '>', '+', '*', '%', '-', '~', '^']);

/** 文字列リテラル 1 件のヒット。 */
export interface VocabularyScanHit {
  /** リポジトリルート相対パス。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** リテラルの中身(クォートを除いた文字列)。 */
  readonly literal: string;
}

/** `__tests__` 配下と `*.test.ts` / `*.test.tsx` は対象外(フィクスチャの値は語彙の実例であって漏れではない)。 */
export function isScannedFile(name: string, extensions: readonly string[]): boolean {
  if (!extensions.some((ext) => name.endsWith(ext))) return false;
  return !/\.test\.tsx?$/.test(name);
}

/**
 * W 群自身の判定ロジック(`w1-vocabulary-leak.ts` / `w2-prose-leak.ts`)は対象外。
 *
 * `KNOWN_COLLISIONS`(既知の衝突の言い訳データ)はその性質上、除外したい語そのものを
 * 文字列として持たざるを得ない(除外規則を書く場所そのものが自己衝突する)。これは
 * `__tests__` のフィクスチャと同じ理由の除外であり、他のファイルの走査結果には影響しない。
 */
const SELF_FILES: readonly string[] = [
  'legacy/spec-tools/lib/generality/verifiers/w1-vocabulary-leak.ts',
  // W2 の散文の衝突表も同じ性質(除外規則を書く場所そのものが自己衝突する)。
  'legacy/spec-tools/lib/generality/verifiers/w2-prose-leak.ts',
];

export function isExcludedPath(relativePath: string): boolean {
  return relativePath.includes('/__tests__/') || SELF_FILES.includes(relativePath);
}

/** 文字列リテラル(シングル・ダブル・テンプレート)の全体(クォート込み)を拾う。 */
export const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** マッチした文字を空白に置き換える(行番号がずれないように改行だけ残す)。 */
function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

/**
 * コメントを空白化する(例示・コメントは対象外 — builder-report-12a.md)。
 *
 * `types-entity.ts` の JSDoc に書いた例示(`` `entry` → `entries` ``)のような、
 * コード上の文字列ではない例示までリテラルとして拾わないための前処理。
 *
 * W3 も同じ前処理を使う(散文は相手にしない、という線を 2 つに割らないため)。
 */
export function stripComments(source: string): string {
  let result = source;
  for (const { start, end } of commentRanges(source)) {
    result = result.slice(0, start) + blank(source.slice(start, end)) + result.slice(end);
  }
  return result;
}

/**
 * `type X = 'a' | 'b';` の形(TS の判別可能な文字列リテラル型)を拾う。
 *
 * `'a'` はここでは**文字列リテラルではなく型の判別子**として使われている ——
 * 実行時の値ではなく、コンパイル時にしか存在しないユニオン型の構成要素である
 * (例: `type World = 'closed' | 'open';`(code-zod.ts の zod スキーマの開閉)・
 * `type FrontmatterDelimiter = 'none' | 'closed' | 'unclosed';`(parse-markdown.ts の
 * フロントマター区切りの状態))。この形は `const X = [...] as const` からユニオン型を
 * 導く形(`GATE_SUBJECTS` 等)とは違い、値そのものを型として直接書いているため、
 * 「型の判別子かどうか」を構文だけで安全に判定できる。
 *
 * この関数が返す語は**そのファイル内に限って**除外する(ファイルを跨いで一律に消すと、
 * 同じ綴りの語が別ファイルで本当に漏れていても見逃してしまう)。
 */
const TYPE_ALIAS_UNION = /\btype\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:\s*\|\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))*)\s*;/g;
const UNION_MEMBER = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

export function collectTypeAliasLiterals(code: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const aliasMatch of code.matchAll(TYPE_ALIAS_UNION)) {
    const union = aliasMatch[1] ?? '';
    for (const memberMatch of union.matchAll(UNION_MEMBER)) {
      words.add(memberMatch[0].slice(1, -1));
    }
  }
  return words;
}

/** TLA+ の行コメント(`\*` から行末まで)。 */
const TLA_LINE_COMMENT = /\\\*[^\n]*/g;

/** TLA+ の文字列(二重引用符だけ。単引用符は素数つき変数であって引用符ではない)。 */
const TLA_STRING = /"(?:[^"\\]|\\.)*"/g;

/** TLA+ のソースから文字列の中身と行番号を抜き出す。 */
function extractTlaLiterals(source: string): ReadonlyArray<{ literal: string; line: number }> {
  const code = source.replace(TLA_LINE_COMMENT, blank);
  const results: Array<{ literal: string; line: number }> = [];
  for (const match of code.matchAll(TLA_STRING)) {
    const index = match.index ?? 0;
    results.push({ literal: match[0].slice(1, -1), line: code.slice(0, index).split('\n').length });
  }
  return results;
}

/** ソース 1 本から文字列リテラルの中身と行番号を抜き出す(コメントは除く。型の判別子は除く)。 */
export function extractLiterals(
  source: string,
  syntax: 'ts' | 'tla' = 'ts',
): ReadonlyArray<{ literal: string; line: number }> {
  if (syntax === 'tla') return extractTlaLiterals(source);
  const code = stripComments(source);
  const typeAliasLiterals = collectTypeAliasLiterals(code);
  const results: Array<{ literal: string; line: number }> = [];
  for (const match of code.matchAll(STRING_LITERAL)) {
    const raw = match[0];
    const literal = raw.slice(1, -1);
    if (typeAliasLiterals.has(literal)) continue;
    const index = match.index ?? 0;
    const line = code.slice(0, index).split('\n').length;
    results.push({ literal, line });
  }
  return results;
}

/** ファイルを読む。読めなければ空文字(走査は best-effort であり、ここで検証を止めない)。 */
export function readText(absolute: string): string {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}
