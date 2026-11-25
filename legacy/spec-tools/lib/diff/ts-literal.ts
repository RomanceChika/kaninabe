/**
 * 生成 TS の中の**素のデータ**(`export const X = { … } as const;`)を読む小さな読取器。
 *
 * なぜ要るか: 差分の元は既にコミットされている生成物であり、基点側はワークツリーに無い
 * (`git show <base>:<path>` の文字列として来る)。**実行して import することはできない**ので、
 * 値として読み出す口がここに要る。読むのは「文字列・数・真偽・null・配列・オブジェクト」だけで、
 * 識別子の参照(`createRules: checkItemCreateRules` のような形)は素のデータではないと答える
 * —— そういうファイル(実行計画)からは `topLevelKeys` で鍵だけを取る。
 *
 * **throw しない**(scripts-code-quality.md)。読めなかったことは `ok: false` と理由で返し、
 * 呼び出し側が「判定できない」として報告する。
 *
 * 純粋関数であり I/O を持たない。**アプリの語彙は 1 語も持たない。**
 */

/** 素のデータの値(JSON と同じ形。生成 TS が持てるのはこれだけ)。 */
export type PlainValue = string | number | boolean | null | readonly PlainValue[] | PlainObject;

/** 素のデータのオブジェクト。 */
export interface PlainObject {
  readonly [key: string]: PlainValue;
}

/**
 * 読み取りの結果(読めた / 読めなかった理由)。
 *
 * `missing` は「**その版にその宣言が無かった**」であり、「読めなかった」ではない ——
 * 生成物は版ごとに export が増えるので、この 2 つを畳むと古い版を読むたびに
 * 「判定できない」が湧く(逆に畳んで黙らせると、壊れた生成物が通る)。
 */
export type ReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly missing?: boolean };

/** 走査の位置(値とその次の位置)。 */
interface Cursor<T> {
  readonly value: T;
  readonly next: number;
}

/** 空白と 2 種のコメントを読み飛ばした位置。 */
function skipTrivia(source: string, from: number): number {
  let index = from;
  for (;;) {
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    return index;
  }
}

/** 引用符 1 つぶんを読む(`'` / `"` / バッククォート。置換式は素のデータではないので扱わない)。 */
function readString(source: string, from: number): ReadResult<Cursor<string>> {
  const quote = source[from];
  if (quote === undefined) return { ok: false, reason: '文字列の途中で終わりました' };
  let index = from + 1;
  let text = '';
  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === '\\') {
      const escaped = source[index + 1] ?? '';
      text += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
      index += 2;
      continue;
    }
    if (char === quote) return { ok: true, value: { value: text, next: index + 1 } };
    text += char;
    index += 1;
  }
  return { ok: false, reason: '文字列が閉じていません' };
}

/** 配列 1 つを読む。 */
function readArray(source: string, from: number): ReadResult<Cursor<PlainValue>> {
  const items: PlainValue[] = [];
  let index = skipTrivia(source, from + 1);
  while (index < source.length) {
    if (source[index] === ']') return { ok: true, value: { value: items, next: index + 1 } };
    const item = readValue(source, index);
    if (!item.ok) return item;
    items.push(item.value.value);
    index = skipTrivia(source, item.value.next);
    if (source[index] === ',') index = skipTrivia(source, index + 1);
  }
  return { ok: false, reason: '配列が閉じていません' };
}

/** オブジェクトの鍵 1 つを読む(引用符つき / 素の識別子のどちらも)。 */
function readKey(source: string, from: number): ReadResult<Cursor<string>> {
  const char = source[from] ?? '';
  if (char === "'" || char === '"' || char === '`') return readString(source, from);
  const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(from));
  if (match === null) return { ok: false, reason: `鍵として読めない字があります: ${source.slice(from, from + 12)}` };
  return { ok: true, value: { value: match[0], next: from + match[0].length } };
}

/** オブジェクト 1 つを読む。 */
function readObject(source: string, from: number): ReadResult<Cursor<PlainValue>> {
  const entries: Record<string, PlainValue> = {};
  let index = skipTrivia(source, from + 1);
  while (index < source.length) {
    if (source[index] === '}') return { ok: true, value: { value: entries, next: index + 1 } };
    const key = readKey(source, index);
    if (!key.ok) return key;
    index = skipTrivia(source, key.value.next);
    if (source[index] !== ':') return { ok: false, reason: `鍵 ${key.value.value} の後ろに : がありません` };
    const item = readValue(source, skipTrivia(source, index + 1));
    if (!item.ok) return item;
    entries[key.value.value] = item.value.value;
    index = skipTrivia(source, item.value.next);
    if (source[index] === ',') index = skipTrivia(source, index + 1);
  }
  return { ok: false, reason: 'オブジェクトが閉じていません' };
}

/** 値 1 つを読む(素のデータでなければ理由を返す)。 */
function readValue(source: string, from: number): ReadResult<Cursor<PlainValue>> {
  const index = skipTrivia(source, from);
  const char = source[index] ?? '';
  if (char === '{') return readObject(source, index);
  if (char === '[') return readArray(source, index);
  if (char === "'" || char === '"' || char === '`') return readString(source, index);
  const word = /^(true|false|null|undefined)\b/.exec(source.slice(index));
  if (word !== null) {
    const literal = word[0] === 'true' ? true : word[0] === 'false' ? false : null;
    return { ok: true, value: { value: literal, next: index + word[0].length } };
  }
  const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(index));
  if (number !== null) return { ok: true, value: { value: Number(number[0]), next: index + number[0].length } };
  return { ok: false, reason: `素のデータではありません(識別子・式): ${source.slice(index, index + 24).trim()}` };
}

/** `export const {名前}` の `=` の位置(型注釈の中に `=` は来ない)。 */
function valueStart(source: string, name: string): number {
  const declaration = new RegExp(`export\\s+const\\s+${name}\\b`).exec(source);
  if (declaration === null) return -1;
  const equals = source.indexOf('=', declaration.index + declaration[0].length);
  return equals === -1 ? -1 : equals + 1;
}

/**
 * 生成 TS から `export const {name} = …` の値を素のデータとして読む。
 *
 * @param source ファイルの中身そのまま
 * @param name 読み出す export の名前
 * @returns 値、または読めなかった理由(宣言が無い場合も理由で返す)
 */
export function readExportedValue(source: string, name: string): ReadResult<PlainValue> {
  const start = valueStart(source, name);
  if (start === -1) return { ok: false, reason: `export const ${name} が見つかりません`, missing: true };
  const read = readValue(source, start);
  return read.ok ? { ok: true, value: read.value.value } : read;
}

/**
 * `export const` の名前を、綴りの形で拾う(集約名を仕組み側が持たないため)。
 *
 * @param source ファイルの中身そのまま
 * @param pattern 名前に当てる正規表現(`g` を付けずに渡す。1 つ目の捕獲が接頭辞になる)
 * @returns 一致した export 名と捕獲(宣言順)
 */
export function exportedNames(source: string, pattern: RegExp): readonly { name: string; captured: string }[] {
  const scan = new RegExp(`export\\s+const\\s+(${pattern.source})`, 'g');
  const found: { name: string; captured: string }[] = [];
  for (const match of source.matchAll(scan)) {
    found.push({ name: match[1] ?? '', captured: match[2] ?? '' });
  }
  return found;
}

/**
 * 素のデータではないオブジェクト(識別子の参照を値に持つ実行計画など)から、**鍵だけ**を取る。
 *
 * 値は括弧の対応と引用符の状態だけを見て読み飛ばすので、中身が何であっても鍵は取れる。
 *
 * @param source ファイルの中身そのまま
 * @param name 読み出す export の名前
 * @returns 第 1 階層の鍵(宣言順)、または読めなかった理由
 */
export function topLevelKeys(source: string, name: string): ReadResult<readonly string[]> {
  const start = valueStart(source, name);
  if (start === -1) return { ok: false, reason: `export const ${name} が見つかりません`, missing: true };
  const open = skipTrivia(source, start);
  if (source[open] !== '{') return { ok: false, reason: `export const ${name} はオブジェクトではありません` };
  const keys: string[] = [];
  let depth = 0;
  let buffer = '';
  let index = open;
  while (index < source.length) {
    const skipped = skipTrivia(source, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const char = source[index] ?? '';
    if (char === "'" || char === '"' || char === '`') {
      const text = readString(source, index);
      if (!text.ok) return text;
      if (depth === 1) buffer = text.value.value;
      index = text.value.next;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      buffer = '';
      index += 1;
      if (depth === 0) return { ok: true, value: keys };
      continue;
    }
    if (depth === 1 && char === ':') {
      if (buffer.trim() !== '') keys.push(buffer.trim());
      buffer = '';
    } else if (depth === 1 && char === ',') {
      buffer = '';
    } else if (depth === 1) {
      buffer += char;
    }
    index += 1;
  }
  return { ok: false, reason: `export const ${name} が閉じていません` };
}

/**
 * 素のデータをそのまま読む(結果表の元データのような JSON もこの読取器で足りる)。
 *
 * @param source ファイルの中身そのまま
 * @returns 値、または読めなかった理由
 */
export function readPlainValue(source: string): ReadResult<PlainValue> {
  const read = readValue(source, 0);
  return read.ok ? { ok: true, value: read.value.value } : read;
}
