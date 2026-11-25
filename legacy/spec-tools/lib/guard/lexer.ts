/**
 * ガード式の字句解析。
 *
 * 文法の正: domain-spec-writing.md §ガード式の文法。
 * EBNF は `literal` の字句を定義していないため、本実装では次の 3 種を literal トークンとする。
 *   - number:   -?123 / -?1.5
 *   - datetime: 2026-01-01 / 2026-01-01T09:00:00Z(ISO 8601 の日付・日時)
 *   - name:     裸の識別子(ドットで連結して `actor.id` のようなドット付きリテラルも作れる)
 *
 * 失敗は例外ではなく Result で返す(検証器が Finding に変換しやすいように)。
 */

import type { GuardParseError } from './ast.js';

/** トークン種別。 */
export type TokenKind =
  | 'name'
  | 'number'
  | 'datetime'
  | 'operator'
  | 'dot'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'eof';

/** 1 トークン。offset はソース文字列内の開始位置(0 始まり)。 */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly offset: number;
}

/** 字句解析の結果。 */
export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: GuardParseError };

/**
 * 予約語。パス名・リテラルとして使えない。
 *
 * `is` / `null` は束 ㉒(`path is [not] null`)で足した。**欄名・enum 値・状態 ID として
 * 使えなくなる**ので、規約(domain-spec-writing.md §ガード式の文法)に明記してある。
 */
export const KEYWORDS = ['and', 'or', 'not', 'in', 'contains', 'is', 'null'] as const;

/** 予約語の型。 */
export type Keyword = (typeof KEYWORDS)[number];

/** トークンが予約語 kw であるか。 */
export function isKeyword(token: Token, kw: Keyword): boolean {
  return token.kind === 'name' && token.text === kw;
}

/** トークンが何らかの予約語であるか(識別子として使えないことの判定)。 */
export function isAnyKeyword(token: Token): boolean {
  return token.kind === 'name' && (KEYWORDS as readonly string[]).includes(token.text);
}

const RE_SPACE = /\s+/y;
const RE_DATETIME = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/y;
const RE_NUMBER = /-?\d+(?:\.\d+)?/y;
const RE_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

const TWO_CHAR_OPERATORS = ['==', '!=', '<=', '>='];
const ONE_CHAR_OPERATORS = ['<', '>'];

const PUNCTUATION: ReadonlyMap<string, TokenKind> = new Map([
  ['.', 'dot'],
  ['[', 'lbracket'],
  [']', 'rbracket'],
  [',', 'comma'],
]);

/** 位置指定で正規表現を試し、マッチしたテキストを返す(しなければ null)。 */
function tryMatch(re: RegExp, source: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(source);
  return m === null ? null : m[0];
}

/**
 * ソース文字列をトークン列に分解する。末尾には必ず eof トークンが 1 つ入る。
 *
 * @param source ガード式の生文字列
 * @returns 成功なら tokens、失敗なら位置付きのエラー
 */
export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < source.length) {
    const space = tryMatch(RE_SPACE, source, pos);
    if (space !== null) {
      pos += space.length;
      continue;
    }

    const token = nextToken(source, pos);
    if (token === null) {
      return {
        ok: false,
        error: { message: `使えない文字 "${source[pos] ?? ''}" があります`, offset: pos, length: 1 },
      };
    }
    tokens.push(token);
    pos += token.text.length;
  }

  tokens.push({ kind: 'eof', text: '', offset: source.length });
  return { ok: true, tokens };
}

/** pos から始まる 1 トークンを切り出す(空白は呼び出し側で処理済み)。 */
function nextToken(source: string, pos: number): Token | null {
  const datetime = tryMatch(RE_DATETIME, source, pos);
  if (datetime !== null) return { kind: 'datetime', text: datetime, offset: pos };

  const num = tryMatch(RE_NUMBER, source, pos);
  if (num !== null) return { kind: 'number', text: num, offset: pos };

  const name = tryMatch(RE_NAME, source, pos);
  if (name !== null) return { kind: 'name', text: name, offset: pos };

  const two = source.slice(pos, pos + 2);
  if (TWO_CHAR_OPERATORS.includes(two)) return { kind: 'operator', text: two, offset: pos };

  const one = source.slice(pos, pos + 1);
  if (ONE_CHAR_OPERATORS.includes(one)) return { kind: 'operator', text: one, offset: pos };

  const punctuation = PUNCTUATION.get(one);
  if (punctuation !== undefined) return { kind: punctuation, text: one, offset: pos };

  return null;
}
