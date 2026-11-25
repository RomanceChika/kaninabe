/**
 * SQL の本文の**字面の読み方**(識別子の検査が使う)。
 *
 * コメント・文字列リテラル・ドル引用の本文は「コードではない」ので空白に潰し、引用符つきの識別子は残す。
 * 正規表現を順に当てると、文字列の中の `--` や `/*`、コメントの中の引用符、`''` / `""` / `E'\\''` の逃がしの順序を誤る —— 1 文字ずつ読む。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/** 引用符つき識別子の中の `""`(引用符 1 文字)を、正規表現の `[^"]+` に載せるための代用の 1 文字。測るときに `"` に戻す。 */
export const QUOTE_MARK = '\u0001';

/** 識別子の文字(引用符なしの綴りの途中に現れうる文字)。 */
const IDENT_CHAR = /[\w$\u0080-\uFFFF]/;

/**
 * コメント・文字列リテラル・ドル引用の本文を空白に潰し、引用符つきの識別子は残す。
 *
 * 1 文字ずつ読む(コメントと文字列の入れ子を正規表現の順番で誤らない): `--` と入れ子の `/* … *\/` はコメント、`'…'`(`''` は
 * 引用符 1 文字。`E'…'` は `\` でも逃がす)は `''` に、`$tag$ … $tag$` は空白にする。`"…"`(`""` は引用符 1 文字)は
 * 中身を残し、`""` は代用の 1 文字にする(`[^"]+` に収まるように)。
 */
export function normalize(sql: string): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      index = end < 0 ? sql.length : end;
      out += ' ';
    } else if (char === '/' && next === '*') {
      index = skipBlockComment(sql, index);
      out += ' ';
    } else if (char === "'") {
      const escapes = /[eE]/.test(sql[index - 1] ?? '') && !IDENT_CHAR.test(sql[index - 2] ?? ' ');
      index = skipString(sql, index, escapes);
      out += "''";
    } else if (char === '"') {
      const read = readQuoted(sql, index);
      out += read.text;
      index = read.end;
    } else if (char === '$' && !IDENT_CHAR.test(sql[index - 1] ?? ' ')) {
      const tag = /^\$[A-Za-z_\u0080-\uFFFF]*\$/.exec(sql.slice(index))?.[0];
      const close = tag === undefined ? -1 : sql.indexOf(tag, index + tag.length);
      if (tag === undefined || close < 0) {
        out += char;
        index += 1;
      } else {
        out += ' ';
        index = close + tag.length;
      }
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** 入れ子のブロックコメントの終わりの次の位置(閉じていなければ末尾)。 */
function skipBlockComment(sql: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < sql.length) {
    if (sql.startsWith('/*', index)) {
      depth += 1;
      index += 2;
    } else if (sql.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return sql.length;
}

/** 文字列リテラルの終わりの次の位置(`''` は引用符 1 文字。`E'…'` は `\` でも逃がす)。 */
function skipString(sql: string, start: number, backslash: boolean): number {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index];
    if (backslash && char === '\\') index += 2;
    else if (char === "'" && sql[index + 1] === "'") index += 2;
    else if (char === "'") return index + 1;
    else index += 1;
  }
  return sql.length;
}

/** 引用符つき識別子を読む(`""` は代用の 1 文字にして、全体を `"…"` で返す)。 */
function readQuoted(sql: string, start: number): { readonly text: string; readonly end: number } {
  let index = start + 1;
  let body = '';
  while (index < sql.length) {
    const char = sql[index];
    if (char === '"' && sql[index + 1] === '"') {
      body += QUOTE_MARK;
      index += 2;
    } else if (char === '"') {
      return { text: `"${body}"`, end: index + 1 };
    } else {
      body += char;
      index += 1;
    }
  }
  return { text: `"${body}"`, end: sql.length };
}

/** 識別子の綴りから引用符を外す(代用の 1 文字は引用符に戻す)。 */
export function unquote(token: string): string {
  const inner = token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
  return inner.split(QUOTE_MARK).join('"');
}

