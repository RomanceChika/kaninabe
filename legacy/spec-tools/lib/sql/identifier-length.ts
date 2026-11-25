/**
 * 生成する SQL の**識別子の長さ**(PostgreSQL は 63 バイトを超える識別子を黙って切り詰める)。
 *
 * ポリシー名・関数名・トリガ名・索引名・制約名・表名は、仕様の名前(集約・ロール・欄)を継いで組み立てる。
 * 長い名前の組み合わせは 63 バイトを超え、**エラーにならずに末尾が切り落とされる** —— 切り詰めの結果が別の名前と
 * 同じになれば(接頭辞が同じ長い名前が 2 つあるとき)、`drop policy if exists` が別のポリシーを消し、
 * `create or replace function` が別の関数を上書きする。生成器が出す名前と DB に実在する名前が食い違うので、
 * 構造の突合(data-table-parity)も名前で外れる。
 *
 * そこで、**書き出す前に** SQL の本文から「名前を与える文」の名前を拾って長さを見る。個々の生成器が名前の組み立てを
 * 知っている必要は無い(組み立ての場所は多いが、名前を与える文の字面は PostgreSQL の文法で閉じている)。
 * 見るのは引用符つきの名前も含めた**バイト数**(UTF-8。日本語の名前は 1 字 3 バイトで先に超える)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { MAX_IDENTIFIER_BYTES } from '../model/sql-fragment.js';
import { normalize, unquote } from './sql-code-view.js';

export { MAX_IDENTIFIER_BYTES };

/** 上限を超えた識別子 1 件。 */
export interface LongIdentifier {
  /** 名前の種類(`policy` / `function` / `trigger` / `index` / `constraint` / `table` / `view` / `type` / `domain` / `sequence` / `schema` / `role` / `column` / `rename`)。 */
  readonly kind: string;
  /** 識別子(引用符を外したもの)。 */
  readonly name: string;
  /** UTF-8 のバイト数。 */
  readonly bytes: number;
}

/** 識別子 1 つ(引用符つきも可。`normalize` が引用符つきの中身を `[^"]+` に収まる形にしてある)。スキーマ修飾は `(?:識別子\.)?` で読み飛ばす。 */
const IDENT = '(?:"[^"]+"|[A-Za-z_\\u0080-\\uFFFF][\\w$\\u0080-\\uFFFF]*)';
const QUALIFIED = `(?:${IDENT}\\.)?(${IDENT})`;

/** 名前を与える文の形(キーワードの並びのあとに名前が来る)。 */
const DEFINITIONS: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'policy', pattern: new RegExp(`\\bcreate\\s+policy\\s+${IDENT}`, 'gi') },
  { kind: 'function', pattern: new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+${QUALIFIED}`, 'gi') },
  { kind: 'trigger', pattern: new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+${IDENT}`, 'gi') },
  { kind: 'index', pattern: new RegExp(`\\bcreate\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${IDENT}`, 'gi') },
  {
    kind: 'table',
    pattern: new RegExp(`\\bcreate\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary)\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}`, 'gi'),
  },
  {
    kind: 'view',
    pattern: new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:(?:temp|temporary)\\s+)?(?:recursive\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}`, 'gi'),
  },
  { kind: 'type', pattern: new RegExp(`\\bcreate\\s+type\\s+${QUALIFIED}`, 'gi') },
  { kind: 'domain', pattern: new RegExp(`\\bcreate\\s+domain\\s+${QUALIFIED}`, 'gi') },
  { kind: 'sequence', pattern: new RegExp(`\\bcreate\\s+(?:temp\\s+|temporary\\s+|unlogged\\s+)?sequence\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}`, 'gi') },
  { kind: 'schema', pattern: new RegExp(`\\bcreate\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}`, 'gi') },
  { kind: 'role', pattern: new RegExp(`\\bcreate\\s+(?:role|user|group)\\s+${IDENT}`, 'gi') },
  { kind: 'constraint', pattern: new RegExp(`\\bconstraint\\s+${IDENT}`, 'gi') },
  // 付け替え: `rename to {新}` / `rename [column|constraint|attribute] {旧} to {新}`(新しい名前が上限を超えれば同じ切り詰めに当たる)
  { kind: 'rename', pattern: new RegExp(`\\brename\\s+to\\s+${IDENT}`, 'gi') },
  { kind: 'rename', pattern: new RegExp(`\\brename\\s+(?:column\\s+|constraint\\s+|attribute\\s+)?${IDENT}\\s+to\\s+${IDENT}`, 'gi') },
  // 列の追加(`add column` を省いた形は、制約の語と区別して拾う)
  { kind: 'column', pattern: new RegExp(`\\badd\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?${IDENT}`, 'gi') },
];

/** `add {語}` の語が列の名前ではなく制約の始まりのとき(列の追加として数えない)。 */
const NOT_A_COLUMN: ReadonlySet<string> = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'column', 'if']);

/** 表の定義の本体で、列ではなく制約・複製の始まりの語。 */
const NOT_A_COLUMN_DEFINITION: ReadonlySet<string> = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like', 'period']);

/** マッチした文の名前の部分(最後の識別子)を取り出す。 */
function nameOf(matched: string): string {
  const tokens = matched.match(new RegExp(IDENT, 'g')) ?? [];
  return unquote(tokens[tokens.length - 1] ?? '');
}

/** 識別子の UTF-8 のバイト数。 */
function bytesOf(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * `create table … ( 定義, 定義, … )` の列の名前(制約・複製の定義は除く)。
 *
 * 括弧の深さで定義の区切りのコンマを見分ける(型の `numeric(10, 2)` や `check (a in (1, 2))` のコンマで割らない)。
 */
function columnNames(code: string): readonly string[] {
  const names: string[] = [];
  const start = new RegExp(`\\bcreate\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary)\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}\\s*\\(`, 'gi');
  for (const match of code.matchAll(start)) {
    const parts: string[] = [];
    let depth = 1;
    let quoted = false;
    let part = '';
    for (let index = (match.index ?? 0) + match[0].length; index < code.length && depth > 0; index += 1) {
      const char = code[index] ?? '';
      if (char === '"') quoted = !quoted;
      if (!quoted && char === '(') depth += 1;
      if (!quoted && char === ')') depth -= 1;
      if (depth === 0) break;
      if (!quoted && depth === 1 && char === ',') {
        parts.push(part);
        part = '';
      } else {
        part += char;
      }
    }
    parts.push(part);
    for (const definition of parts) {
      const first = new RegExp(`^\\s*(${IDENT})`).exec(definition)?.[1];
      if (first !== undefined && !NOT_A_COLUMN_DEFINITION.has(first.toLowerCase())) names.push(unquote(first));
    }
  }
  return names;
}

/**
 * SQL の本文のうち、名前が 63 バイトを超える定義を全部返す(種類の並び → 出現順・重複なし)。
 *
 * 名前を与える文の名前(ポリシー・関数・トリガ・索引・表・ビュー・型・ドメイン・順序・スキーマ・ロール・制約)、
 * **列の名前**(`create table` の定義と `add column`)、**付け替えの新しい名前**(`rename … to`)を見る。
 * ドル引用の本文(関数の中身)は読まない —— 中の動的な文は静的に読めない。
 *
 * @param sql SQL の本文
 * @returns 上限を超えた識別子(無ければ空)
 */
export function longIdentifiers(sql: string): readonly LongIdentifier[] {
  const code = normalize(sql);
  const found: LongIdentifier[] = [];
  const seen = new Set<string>();
  const push = (kind: string, name: string): void => {
    const bytes = bytesOf(name);
    const key = `${kind}\u0000${name}`;
    if (bytes <= MAX_IDENTIFIER_BYTES || seen.has(key)) return;
    seen.add(key);
    found.push({ kind, name, bytes });
  };
  for (const { kind, pattern } of DEFINITIONS) {
    for (const match of code.matchAll(pattern)) {
      const name = nameOf(match[0]);
      if (kind === 'column' && NOT_A_COLUMN.has(name.toLowerCase())) continue;
      push(kind, name);
    }
  }
  for (const name of columnNames(code)) push('column', name);
  return found;
}

/** 1 件の指摘の文(`{種類} {名前} は {n} バイト…`)。 */
export function longIdentifierText(entry: LongIdentifier): string {
  return `${entry.kind} ${entry.name} は ${entry.bytes} バイトで、PostgreSQL の識別子の上限(${MAX_IDENTIFIER_BYTES} バイト)を超えます(超えた分は黙って切り詰められ、別の名前と衝突しうる)`;
}

/** 対処の文(名前の出どころを短くする)。 */
export const LONG_IDENTIFIER_SUGGESTION =
  '名前の出どころ(集約名・ロール名・欄名・data_table の関数名や migration の宣言)を短くする。' +
  '生成する名前は仕様の名前を継いで組み立てるので、長い名前が 2 つ並ぶと切り詰められた先頭が一致して衝突する';

/** 指摘 1 件(生成器が検査器の Finding に写す 3 点セット)。 */
export interface IdentifierProblem {
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
}

/**
 * SQL の本文の識別子が上限に収まらないものを、指摘の形にして返す。
 *
 * @param sql SQL の本文
 * @returns 指摘(収まっていれば空)
 */
export function identifierProblems(sql: string): readonly IdentifierProblem[] {
  return longIdentifiers(sql).map((entry) => ({
    message: longIdentifierText(entry),
    suggestion: LONG_IDENTIFIER_SUGGESTION,
    counterexample: { kind: entry.kind, name: entry.name, bytes: String(entry.bytes) },
  }));
}

/** 書き出す 1 ファイルぶんのセクション(この関所が読むのは中身だけ)。 */
interface SectionContent {
  readonly content: string;
}

/** 書き出しの拒否 1 件(どのファイルを、なぜ)。 */
export interface IdentifierRefusal {
  readonly file: string;
  readonly reason: string;
}

/**
 * 書き出す SQL のうち、識別子が上限を超えるものを `{ファイル, 理由}` にして返す(生成の関所)。
 *
 * 生成器ごとに名前の長さを知る必要は無く、**名前を与える文の字面**を拾うので、新しい SQL の生成器が増えても漏れない。
 * `.sql` 以外のファイル(Markdown・TypeScript)は SQL の文法ではないので見ない。
 *
 * @param byFile ファイル(リポジトリルート相対)→ そのファイルへのセクション一覧
 * @returns 超えた識別子ごとの拒否(ファイル名順。無ければ空 = 書いてよい)
 */
export function longIdentifierRefusals(byFile: ReadonlyMap<string, readonly SectionContent[]>): readonly IdentifierRefusal[] {
  const refusals: IdentifierRefusal[] = [];
  for (const [file, sections] of byFile) {
    if (!file.endsWith('.sql')) continue;
    for (const section of sections) {
      for (const entry of longIdentifiers(section.content)) {
        refusals.push({ file, reason: `${longIdentifierText(entry)}。${LONG_IDENTIFIER_SUGGESTION}` });
      }
    }
  }
  return refusals.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
