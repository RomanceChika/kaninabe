/**
 * data_table の `defaults` の **SQL の式**を、R2 が値として読める形だけ読む(閉じた読み手)。
 *
 * R2 の「作成の初期値が役を与えるか」はこの読み手を通す。読める形は次の 3 つだけで、ほかは全部「読めない」である:
 *
 * | 形 | 例 | 読んだ値 |
 * |---|---|---|
 * | 文字列のリテラル | `'pro'`・`'it''s'` | 綴りのまま(大文字小文字を変えない) |
 * | 数値・真偽値 | `0`・`-1.5`・`true`・`FALSE` | 字面のまま |
 * | NULL | `null`・`NULL` | 値なし |
 *
 * どの形にも、式全体の括弧(`('pro'::text)`)と型の注釈(`::text`・`::account_tier`・`::public.account_tier`・
 * `::character varying(10)`)を重ねてよい。関数の呼び出し・連結・`E'…'` などは式の値が字面から決まらないので読まない。
 *
 * **読めない形を「役を与えない」に倒さない**(点検 11 回目 A11-1)。以前は読み手が値を小文字に潰し、型の除去も `::[a-z ]+$` だけで、
 * 大文字を含む enum の値・下線のある型・括弧が「読めたが一致しない」に落ちて、役を与える既定値の経路が黙って消えた。
 * 比較の大文字小文字を無視するのは boolean の欄だけである(`true` / `TRUE`。PostgreSQL の真偽値の綴り)。
 * boolean の欄で `true` / `false` のどちらでもない字面(`'t'` など)も読めない形に数える。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/** 式を読んだ結果(`value` が null なら SQL の NULL)。 */
export type DefaultLiteral = { readonly readable: true; readonly value: string | null } | { readonly readable: false };

/** 既定値がその役を与えるか。`unreadable` は「仕様から追えない」で、`supplied_by: db` と同じ扱いにする。 */
export type DefaultGrant = 'grants' | 'none' | 'unreadable';

/** 読めない形。 */
const UNREADABLE: DefaultLiteral = { readable: false };

/** 型の名前(スキーマ修飾・引用符つきの 1 語、または 2 語の組み込みの型名)。 */
const TYPE_NAME = String.raw`(?:character varying|double precision|(?:"?[A-Za-z_][\w$]*"?\.)?"?[A-Za-z_][\w$]*"?)`;

/** 式の末尾の型の注釈(長さの指定・配列を含む)。 */
const TRAILING_CAST = new RegExp(String.raw`::\s*${TYPE_NAME}(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?$`, 'iu');

/** 文字列のリテラル全体(`''` は 1 文字の `'`)。 */
const STRING_LITERAL = /^'((?:[^']|'')*)'$/u;

/** 数値・真偽値の字面。 */
const BARE_LITERAL = /^(?:-?\d+(?:\.\d+)?|true|false)$/iu;

/** 字面の NULL。 */
const NULL_LITERAL = /^null$/iu;

/** 外側の括弧を 1 組はがす(はがせなければそのまま)。中身の整合は最後の文字列・字面の照合が閉じる。 */
function stripParens(text: string): string {
  return text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1).trim() : text;
}

/**
 * 既定値の式を読む。
 *
 * @param raw data_table の `defaults` に書かれた SQL の式
 * @returns 読んだ値。読める形でなければ `readable: false`
 */
export function readDefaultLiteral(raw: string): DefaultLiteral {
  let text = raw.trim();
  for (;;) {
    const next = stripParens(text.replace(TRAILING_CAST, '').trim());
    if (next === text) break;
    text = next;
  }
  const quoted = STRING_LITERAL.exec(text);
  if (quoted !== null) return { readable: true, value: (quoted[1] ?? '').replace(/''/gu, "'") };
  if (BARE_LITERAL.test(text)) return { readable: true, value: text };
  return NULL_LITERAL.test(text) ? { readable: true, value: null } : UNREADABLE;
}

/**
 * 既定値の式がその役を与えるかを判定する。
 *
 * @param raw data_table の `defaults` に書かれた SQL の式
 * @param values `claim` の値の集合(boolean の欄なら null)
 * @returns 与える / 与えない / 読めない
 */
export function defaultGrant(raw: string, values: readonly string[] | null | undefined): DefaultGrant {
  const literal = readDefaultLiteral(raw);
  if (!literal.readable) return 'unreadable';
  if (literal.value === null) return 'none';
  if (values !== null && values !== undefined) return values.includes(literal.value) ? 'grants' : 'none';
  const word = literal.value.toLowerCase();
  if (word === 'true') return 'grants';
  return word === 'false' ? 'none' : 'unreadable';
}
