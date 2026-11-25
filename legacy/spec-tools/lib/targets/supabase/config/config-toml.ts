/**
 * Supabase のローカル設定ファイル(`config.toml`)を読む最小の TOML リーダー。
 *
 * H5(サインインの方式と公開スキーマの突合)が見るのは `[セクション]` 直下の `キー = 真偽値 / 文字列 / 文字列の配列` だけなので、
 * TOML の全部は読まない(日時は対象外)。**読めない値は捨てずに `unreadable` で返す**
 * (読めなかったことを呼び出し側が見張れるようにする。黙って「無効」に倒さない)。
 *
 * **フルパスに畳めない書き方、または読み違えうる書き方は、値を読まずに `shapes` として返す**。読み落とすと、開いている口が検査をすり抜ける:
 *   - インラインテーブル・ドット付きのキー・引用符つきでドットを含むセクション名・配列表(`github = { enabled = true }` や `auth.external.github.enabled = true`)
 *   - 複数行の文字列(`"""` / `'''`): 中の見出しや `キー = 値` に見える行を設定として読まないよう、閉じるまで読み飛ばす(中身は読まない)
 *   - エスケープを含む引用符つきの名前(`"\u0061uth"`): 名前は復号して読む(口を見落とさない)が、書き直しを求めるため shape にも返す
 *   - 見出しでも `キー = 値` でもない行(`[a.b] junk`・`]` の無い見出し・書けないキー)
 * それをどの範囲で赤にするかは呼び出し側が決める。純粋な関数で、例外を投げない。
 */

/** 1 つの値。読めない書き方は元の文字列を `unreadable` に持つ。 */
export type TomlValue = boolean | number | string | readonly string[] | { readonly unreadable: string };

/** セクションの名前(`auth.email` など。ルートは空文字)→ キー → 値。 */
export type TomlDoc = ReadonlyMap<string, ReadonlyMap<string, TomlValue>>;

/** 引用符の外の `#` から後ろ(コメント)を落とす。 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/** 引用符の外の `[` と `]` の数の差(複数行の配列の終わりを見つける)。 */
function bracketDepth(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
  }
  return depth;
}

/** 引用符つきの文字列 1 つ(外側の引用符を外す)。そうでなければ null。 */
function unquote(text: string): string | null {
  const trimmed = text.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed) ?? /^'([^']*)'$/.exec(trimmed);
  return quoted?.[1] ?? null;
}

/** TOML の基本文字列のエスケープ(`\n`・`\u0061` など)を復号する(復号できない書き方はそのまま残す)。 */
function decodeEscapes(content: string): string {
  const simple: Readonly<Record<string, string>> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
  return content.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([btnfr"\\]))/g, (whole, short: string | undefined, long: string | undefined, plain: string | undefined) => {
    if (plain !== undefined) return simple[plain] ?? whole;
    const point = Number.parseInt(short ?? long ?? '', 16);
    return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

/** 名前の 1 部分(セクション名・キーの一部)。引用符つきなら復号した値を返し、エスケープがあれば `escaped` を立てる。 */
function namePart(part: string): { readonly value: string; readonly escaped: boolean } {
  const trimmed = part.trim();
  const basic = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (basic !== null) return { value: decodeEscapes(basic[1] ?? ''), escaped: (basic[1] ?? '').includes('\\') };
  return { value: unquote(trimmed) ?? trimmed, escaped: false };
}

/** 名前の 1 部分が書けるキーか(素の名前か、引用符つき)。 */
function validNamePart(part: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(part.trim()) || /^"(?:[^"\\]|\\.)*"$/.test(part.trim()) || /^'[^']*'$/.test(part.trim());
}

/**
 * 値が複数行の文字列(3 連引用符)で始まるときの区切り(`"""` / `'''`)。配列の中に現れる形も拾う。
 * 普通の文字列の途中に現れた 3 連引用符は、複数行の文字列ではないので拾わない。
 */
function tripleDelimiter(value: string): string | null {
  const text = value.trim();
  const within = text.startsWith('[') ? text : text.slice(0, 3);
  const basic = within.indexOf('"""');
  const literal = within.indexOf("'''");
  if (basic < 0 && literal < 0) return null;
  return literal < 0 || (basic >= 0 && basic < literal) ? '"""' : "'''";
}

/** `from` 以降で最初に現れる閉じの区切りの直後の位置(無ければ -1)。基本文字列では `\` の次の文字は飛ばす。 */
function closingIndex(text: string, delimiter: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (delimiter === '"""' && text.charAt(i) === '\\') i += 1;
    else if (text.startsWith(delimiter, i)) return i + delimiter.length;
  }
  return -1;
}

/** 値の文字列を読む。 */
function parseValue(raw: string): TomlValue {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  const single = unquote(text);
  if (single !== null) return single;
  if (text.startsWith('[') && text.endsWith(']')) {
    const items = [...text.slice(1, -1).matchAll(/\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:,|$)/g)].map((match) => unquote(match[1] ?? ''));
    const rest = text.slice(1, -1).replace(/\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:,|$)/g, '').trim();
    if (rest === '' && items.every((item): item is string => item !== null)) return items;
  }
  return { unreadable: text };
}

/** 読み落としを避けるため値を読まなかった書き方 1 つ。 */
export interface TomlShape {
  /** それが書かれていたセクション(ルートは空文字)。 */
  readonly section: string;
  /** キー(セクション名の問題のときは空文字)。 */
  readonly key: string;
  /** 書き方の種類。 */
  readonly kind: 'inline_table' | 'dotted_key' | 'quoted_dotted_section' | 'array_table' | 'multiline_string' | 'escaped_name' | 'unrecognized_line';
}

/** 読んだ結果(セクションごとのキーと値・値を読まなかった書き方)。 */
export interface TomlParsed {
  readonly doc: TomlDoc;
  readonly shapes: readonly TomlShape[];
}

/** 引用符の外で `separator` により分ける(引用符つきの部分は引用符ごと残す)。 */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** 引用符の外で最初に現れる `=` の位置(無ければ -1)。 */
function equalsIndex(line: string): number {
  const before = splitOutsideQuotes(line, '=')[0] ?? line;
  return before.length === line.length ? -1 : before.length;
}

/** ヘッダ(`[a . "b"]`)の中身をセクション名にする。引用符つきの部分がドットを含むなら `quotedDot` を、エスケープを含むなら `escaped` を立てる。 */
function sectionName(inner: string): { readonly name: string; readonly quotedDot: boolean; readonly escaped: boolean } {
  const raw = splitOutsideQuotes(inner, '.').map((part) => part.trim());
  const parts = raw.map(namePart);
  const quotedDot = raw.some((part, index) => namePart(part).value !== part && (parts[index]?.value ?? '').includes('.'));
  return { name: parts.map((part) => part.value).join('.'), quotedDot, escaped: parts.some((part) => part.escaped) };
}

/** 見出しでも `キー = 値` でもない行の説明(長すぎる行は切る)。 */
function lineWords(line: string): string {
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/**
 * TOML の本文を、セクションごとのキーと値にする。
 *
 * @param text `config.toml` の本文
 * @returns セクション名 → キー → 値(同じキーは後ろが勝つ。配列表 `[[...]]` は `[[名前]]` という名前のセクションに隔てる)と、値を読まなかった書き方
 */
export function parseToml(text: string): TomlParsed {
  const doc = new Map<string, Map<string, TomlValue>>();
  const shapes: TomlShape[] = [];
  let current = '';
  doc.set(current, new Map());
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index] ?? '').trim();
    if (line === '') continue;
    const header = /^\[(\[)?(.+?)\]?\]$/.exec(line);
    if (header !== null) {
      const { name, quotedDot, escaped } = sectionName(header[2] ?? '');
      current = header[1] === undefined ? name : `[[${name}]]`;
      if (!doc.has(current)) doc.set(current, new Map());
      if (header[1] !== undefined) shapes.push({ section: name, key: '', kind: 'array_table' });
      else if (quotedDot) shapes.push({ section: name, key: '', kind: 'quoted_dotted_section' });
      if (escaped) shapes.push({ section: name, key: '', kind: 'escaped_name' });
      continue;
    }
    const eq = equalsIndex(line);
    const keyParts = eq < 0 ? [] : splitOutsideQuotes(line.slice(0, eq).trim(), '.');
    if (eq < 0 || line.startsWith('[') || !keyParts.every(validNamePart)) {
      shapes.push({ section: current, key: lineWords(line), kind: 'unrecognized_line' });
      continue;
    }
    const names = keyParts.map(namePart);
    const plainKey = names.map((part) => part.value).join('.');
    let value = line.slice(eq + 1);
    if (names.some((part) => part.escaped)) shapes.push({ section: current, key: plainKey, kind: 'escaped_name' });
    if (keyParts.length > 1) shapes.push({ section: current, key: plainKey, kind: 'dotted_key' });
    const delimiter = tripleDelimiter(value);
    if (delimiter !== null) {
      // 複数行の文字列: 閉じるまでの行は設定として読まない(見出しや `キー = 値` に見える行が、本物の設定を上書きしない)。
      let closed = closingIndex(value, delimiter, value.indexOf(delimiter) + delimiter.length);
      while (closed < 0 && index + 1 < lines.length) {
        index += 1;
        closed = closingIndex(lines[index] ?? '', delimiter, 0);
      }
      shapes.push({ section: current, key: plainKey, kind: 'multiline_string' });
      doc.get(current)?.set(plainKey, { unreadable: '(複数行の文字列)' });
      continue;
    }
    while (bracketDepth(value) > 0 && index + 1 < lines.length) {
      index += 1;
      value += ` ${stripComment(lines[index] ?? '').trim()}`;
    }
    if (keyParts.length === 1 && value.trim().startsWith('{')) shapes.push({ section: current, key: plainKey, kind: 'inline_table' });
    doc.get(current)?.set(plainKey, parseValue(value));
  }
  return { doc, shapes };
}
