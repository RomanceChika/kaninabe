/**
 * migration の**拡張の置き場**(C23 の 3 つめの判定。点検 7 回目 A7-3)。
 *
 * PostgREST は `api` を外へ出し、anon / authenticated は `api` の USAGE を持つ。拡張の関数の EXECUTE は
 * PostgreSQL の既定で PUBLIC に付き、migration の役(`postgres`)は `supautils.privileged_extensions` に
 * 載る拡張(`http`・`dblink`・`pg_net` ほか)を作れる。したがって手書きの migration の
 * `create extension if not exists http with schema api;` 1 行で、anon が外から呼べる関数が生える。
 * スキーマを省いた形も migration の役の search_path(`"$user", public, extensions`)で `public` に入る。
 *
 * 閉世界の突合(catalog-kinds-closed-world ほか)は拡張の持ち物を母集合から外している。その除外が
 * 安全なのは「`public` / `api` に拡張の持ち物が 0 件」のときだけで、実 DB の側はそれを閉世界テストが
 * 見る。ここはその前段 —— **書いた時点で**置き場を許可表で閉じる。
 *
 * ## 許可表
 *
 * 置き場は既定で `extensions` だけ(`create extension … with schema extensions` / `schema extensions`)。
 * 例外は置き場を拡張自身が決めて動かせないもの(`FIXED_HOME`)だけで、それは**スキーマを省く**か
 * その置き場を名指すことを許す。`alter extension … set schema` の行き先も `extensions` だけ。
 * 読めない形(引用の崩れ・`execute` の文字列で組み立てた文)は「判定できない」= 違反にする。
 *
 * ## 母集合は「この変更が足したファイル」
 *
 * 採番(`migration-numbering.ts`)と同じく、適用済みの migration は書き換えられない(C23 の ①)ので
 * 歴史は判定しない。歴史にある形(`create extension if not exists pg_net;` —— Supabase が `extensions` に
 * 事前に入れてあり何もしない行)は、実 DB の閉世界テストが「`public` / `api` に 0 件」で見る。
 *
 * 判定は純関数であり、ファイルの中身の取り出し(git)と印字は CLI(`cli/check-migrations.ts`)が持つ。
 */

/** 拡張を置いてよいスキーマ(既定)。 */
export const EXTENSION_SCHEMA = 'extensions';

/**
 * 置き場を拡張自身が固定していて `with schema extensions` を書けないもの(名前 → その置き場)。
 * `pg_cron` は `pg_catalog` に入り、別のスキーマを名指すと作成が落ちる(実 DB の `pg_extension` で確認)。
 */
const FIXED_HOME: ReadonlyMap<string, string> = new Map([['pg_cron', 'pg_catalog']]);

/** 拡張の置き場の破れ 1 件。 */
export interface ExtensionViolation {
  /** migration のパス。 */
  readonly file: string;
  /** 文の頭(空白を 1 つに畳んだもの。報告用)。 */
  readonly statement: string;
  /**
   * 破り方。
   *
   * - `スキーマ指定なし` … `create extension` に `schema` が無い(search_path で `public` に入る)
   * - `許可外のスキーマ` … `extensions`(固定の置き場を持つ拡張はその置き場)以外を名指した
   * - `読めない文` … 形を読めないので判定できない
   */
  readonly kind: 'スキーマ指定なし' | '許可外のスキーマ' | '読めない文';
}

/**
 * 注釈を空白に置き換える(`--` の行注釈と `/* *\/` の塊。塊は PostgreSQL と同じく入れ子を数える)。
 *
 * **文字列・引用の中は注釈として読まない**(点検 8 回目 A8-3 —— 以前は正規表現で剥がしていたので、
 * `comment on schema api is 'x -- y'; create extension http with schema api;` の `--` から行末までが消え、
 * 同じ行の `create extension` が判定の母集合から落ちて緑になった)。字句として読み分けるのは 4 つ:
 * `'…'`(`''` のエスケープ・`E'…'` の `\` のエスケープ)、`"…"`(引用した識別子)、`$タグ$…$タグ$`(ドル引用)、
 * 注釈。文字列の**中身は残す** —— `execute '…create extension…'` を拾って赤にする側に倒すため。ドル引用の中身は
 * 関数の本文(コード)なので同じ読み方で注釈だけを剥がす。閉じない文字列・ドル引用は末尾までを中身として残す(読み落とさない側)。
 */
export function stripComments(sql: string): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      out += ' ';
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      index = blockCommentEnd(sql, index);
      out += ' ';
      continue;
    }
    const dollar = dollarTag(sql, index);
    if (dollar !== null) {
      // ドル引用の中身は関数の本文(コード)なので、同じ読み方で注釈を剥がす(中の文字列・入れ子のドル引用も同じ規則)。
      const end = sql.indexOf(dollar, index + dollar.length);
      const close = end === -1 ? sql.length : end;
      out += dollar + stripComments(sql.slice(index + dollar.length, close)) + (end === -1 ? '' : dollar);
      index = end === -1 ? sql.length : end + dollar.length;
      continue;
    }
    const quoted = quotedEnd(sql, index);
    if (quoted !== null) {
      out += sql.slice(index, quoted);
      index = quoted;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** `/*` から始まる塊の注釈の直後の位置(入れ子を数える。閉じなければ末尾)。 */
function blockCommentEnd(sql: string, start: number): number {
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
    } else index += 1;
  }
  return sql.length;
}

/** 識別子の続きの文字か(ドル引用・`E'` の判定で、直前が語の途中かを見る)。 */
function identifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/** そこから始まる文字列・引用した識別子の直後の位置(どちらでもなければ null。閉じなければ末尾)。 */
function quotedEnd(sql: string, start: number): number | null {
  const char = sql[start];
  if (char === "'") return singleQuotedEnd(sql, start, escapeString(sql, start));
  if (char === '"') {
    let index = start + 1;
    while (index < sql.length) {
      if (sql[index] === '"' && sql[index + 1] === '"') index += 2;
      else if (sql[index] === '"') return index + 1;
      else index += 1;
    }
    return sql.length;
  }
  return null;
}

/** そこから始まるドル引用の開きのタグ(`$$` / `$タグ$`。直前が語の途中・`$1` の位置引数なら null)。 */
function dollarTag(sql: string, start: number): string | null {
  if (sql[start] !== '$' || identifierChar(sql[start - 1])) return null;
  return /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start, start + 64))?.[0] ?? null;
}

/** `E'…'`(`\` がエスケープになる文字列)の開きか。 */
function escapeString(sql: string, quote: number): boolean {
  const prefix = sql[quote - 1];
  return (prefix === 'E' || prefix === 'e') && !identifierChar(sql[quote - 2]);
}

/** `'…'` の直後の位置(`''` は中の引用符。`E'…'` なら `\` の次の 1 文字も中身)。 */
function singleQuotedEnd(sql: string, start: number, backslash: boolean): number {
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

/** 識別子 1 つを読む(`"…"` の引用を外し、素の綴りは小文字に畳む)。読めなければ null。 */
function identifier(token: string | undefined): string | null {
  if (token === undefined) return null;
  const quoted = /^"((?:[^"]|"")+)"$/.exec(token);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/""/g, '"');
  return /^[a-z_][a-z0-9_$-]*$/i.test(token) ? token.toLowerCase() : null;
}

/** 文を語に割る(引用した識別子は 1 語)。 */
function tokens(statement: string): string[] {
  return statement.match(/"(?:[^"]|"")*"|[^\s"]+/g) ?? [];
}

/** 置き場が許されるか。 */
function allowedHome(extension: string, schema: string): boolean {
  return schema === EXTENSION_SCHEMA || FIXED_HOME.get(extension) === schema;
}

/**
 * `create extension` 1 文を判定する。
 *
 * @param words 文の語(`create` `extension` から)
 * @returns 破り方。破れが無ければ null
 */
function createProblem(words: readonly string[]): ExtensionViolation['kind'] | null {
  let at = 2;
  const lower = words.map((word) => word.toLowerCase());
  if (lower[at] === 'if' && lower[at + 1] === 'not' && lower[at + 2] === 'exists') at += 3;
  const name = identifier(words[at]);
  if (name === null) return '読めない文';
  at += 1;
  let schema: string | undefined;
  while (at < words.length) {
    const word = lower[at];
    if (word === 'with') at += 1;
    else if (word === 'schema' || word === 'version') {
      const value = word === 'schema' ? identifier(words[at + 1]) : words[at + 1];
      if (value === null || value === undefined) return '読めない文';
      if (word === 'schema') schema = value;
      at += 2;
    } else if (word === 'cascade') at += 1;
    else return '読めない文';
  }
  if (schema === undefined) return FIXED_HOME.has(name) ? null : 'スキーマ指定なし';
  return allowedHome(name, schema) ? null : '許可外のスキーマ';
}

/**
 * `alter extension` 1 文を判定する(置き場を動かす `set schema` だけを見る)。
 *
 * @param words 文の語(`alter` `extension` から)
 * @returns 破り方。破れが無ければ null
 */
function alterProblem(words: readonly string[]): ExtensionViolation['kind'] | null {
  const lower = words.map((word) => word.toLowerCase());
  const name = identifier(words[2]);
  if (name === null) return '読めない文';
  const set = lower.indexOf('set');
  if (set === -1 || lower[set + 1] !== 'schema') return null;
  const schema = identifier(words[set + 2]);
  if (schema === null) return '読めない文';
  return allowedHome(name, schema) ? null : '許可外のスキーマ';
}

/**
 * 1 本の migration の拡張の置き場の破れを取り出す。
 *
 * `create extension` / `alter extension` の語の並びを注釈を外した本文から**全部**拾い、次の `;` まで
 * (無ければ末尾まで)を 1 文として読む。`execute '…create extension…'` のような文字列の中も拾う
 * (引用符が語に残って「読めない文」か名指したスキーマの判定で赤になる —— 読み落とさない側に倒す)。
 *
 * @param file migration のパス(報告用)
 * @param sql 本文
 * @returns 破れの一覧(出現順)
 */
export function extensionViolations(file: string, sql: string): ExtensionViolation[] {
  const body = stripComments(sql);
  const violations: ExtensionViolation[] = [];
  for (const match of body.matchAll(/\b(create|alter)\s+extension\b/gi)) {
    const start = match.index;
    const end = body.indexOf(';', start);
    const statement = body.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ').trim();
    const words = tokens(statement);
    const kind = match[1]?.toLowerCase() === 'create' ? createProblem(words) : alterProblem(words);
    if (kind !== null) violations.push({ file, statement, kind });
  }
  return violations;
}

/** 破り方ごとの直し方。 */
const REMEDY: Readonly<Record<ExtensionViolation['kind'], string>> = {
  スキーマ指定なし:
    '`with schema extensions` を付ける(省くと migration の役の search_path で `public` に入り、' +
    '拡張の関数が面のロール(未ログイン・ログイン済み)から実行できる形で閉世界の外に置かれる)',
  許可外のスキーマ:
    '拡張は `extensions` に置く(`public` / `api` に置くと、`api` は PostgREST が外へ出すので ' +
    '未ログインのロールが拡張の関数を呼べる。置き場を拡張が固定するもの —— `pg_cron` —— はスキーマを省く)',
  読めない文:
    '`create extension [if not exists] <名前> with schema extensions [cascade];` の 1 文に書き直す' +
    '(文字列で組み立てた `execute` では書かない)',
};

/**
 * 破れの報告文を組み立てる(1 件 2 行 —— 何が・どう直すか)。
 *
 * @param violations `extensionViolations` の結果
 * @returns 出力する行の並び
 */
export function formatExtensionViolations(violations: readonly ExtensionViolation[]): string[] {
  return violations.flatMap((violation) => [
    `C23 拡張の置き場(${violation.kind}): ${violation.file}: ${violation.statement}`,
    `  直し方: ${REMEDY[violation.kind]}`,
  ]);
}
