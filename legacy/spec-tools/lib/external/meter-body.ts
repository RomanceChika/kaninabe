/**
 * 枠を消費する RPC(`meter`)の本文が、宣言した役の述語を持ち、消費を 1 文で原子的に行うかの走査(X8 の材料。純関数)。
 *
 * 口の関門(`authorize`)を忘れても・迂回されても、枠を消費する RPC が DB の行を直に読んで役を持たない実行者を落とす —— 入口と DB の二重の守りである。
 * 片方だけが欠ければ、もう片方が止めているので気付かれない。この走査は**DB 側**の本文が、口が宣言した役と同じ述語(`role_spec` の `claim`。
 * 実行者の行の欄の条件)を持つことを見る。見るのは本文の字面の形(コメントと大文字小文字・空白の違いは吸収する)で、実行して確かめるのは
 * 統合テスト(役を持たない実行者の消費が拒まれる)である。
 *
 * 本文は migration を名前順に読み、その関数を最後に定義したものを採る(`create or replace` が後の版で上書きする)。
 * 純粋関数であり throw しない。
 */

import type { ClaimParts } from '../model/role-claim.js';

/** migration 1 本(名前順に並べて渡す)。 */
export interface MigrationText {
  readonly name: string;
  readonly text: string;
}

/** 正規表現の特殊文字を無害にする。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** 本文を比べやすい形にする(`--` コメントを除き、小文字にし、空白を 1 つにつめる)。 */
export function normalizeSql(text: string): string {
  return text
    .replace(/--[^\n]*/gu, ' ')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** `create [or replace] function [スキーマ.]名前(` の出現(本文の始まりを探す起点)。 */
function definitionStarts(text: string, name: string): readonly number[] {
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:"?[a-z_][a-z0-9_]*"?\\.)?"?${escapeRegExp(name)}"?\\s*\\(`, 'giu');
  return [...text.matchAll(pattern)].map((match) => match.index);
}

/** 起点から `as $tag$ … $tag$` の本文を取り出す(読めなければ null)。 */
function bodyAfter(text: string, start: number): string | null {
  const open = /\bas\s+(\$[a-z_]*\$)/iu.exec(text.slice(start));
  if (open === null) return null;
  const tag = open[1] ?? '$$';
  const from = start + open.index + open[0].length;
  const end = text.indexOf(tag, from);
  return end < 0 ? null : text.slice(from, end);
}

/**
 * 関数の本文を、migration から引く(最後に定義した版)。
 *
 * @param migrations 名前順の migration
 * @param name 関数名(スキーマ抜き)
 * @returns 本文。どの migration にも定義が無い・本文が読めなければ null
 */
export function latestFunctionBody(migrations: readonly MigrationText[], name: string): string | null {
  let latest: string | null = null;
  for (const migration of migrations) {
    for (const start of definitionStarts(migration.text, name)) {
      const body = bodyAfter(migration.text, start);
      if (body !== null) latest = body;
    }
  }
  return latest;
}

/** 実行者の行の別名(本文は何と付けてもよい)。 */
const ALIAS = '[a-z_][a-z0-9_]*';

/** 述語の字面を、別名に依らず探す正規表現にする(`a.state in ('active')` の `a` は任意の別名。値の並びの空白は問わない)。 */
function conditionPattern(condition: ClaimParts): RegExp {
  const field = escapeRegExp(condition.field.toLowerCase());
  if (condition.values === null) return new RegExp(`\\b${ALIAS}\\.${field}\\b`, 'u');
  const values = condition.values.map((value) => `'${escapeRegExp(value.toLowerCase())}'`).join('\\s*,\\s*');
  return new RegExp(`\\b${ALIAS}\\.${field} in \\(\\s*${values}\\s*\\)`, 'u');
}

/** 指摘に載せる述語の綴り(別名は `a`)。 */
function shownCondition(condition: ClaimParts): string {
  return condition.values === null ? `a.${condition.field}` : `a.${condition.field} in (${condition.values.map((value) => `'${value}'`).join(', ')})`;
}

/** 消費が 1 文の原子的な更新か(`insert … on conflict … do update … where` か、`update … set … where … returning`)。 */
const ATOMIC = [/\bon conflict\b[^;]*\bdo update\b[^;]*\bwhere\b/u, /\bupdate\b[^;]*\bset\b[^;]*\bwhere\b[^;]*\breturning\b/u] as const;

/** 本文の最初の書き込み(`insert into` / `update`)の位置(無ければ -1)。 */
function firstWrite(body: string): number {
  return body.search(/\b(?:insert into|update)\b/u);
}

/** 実行者の行を読む表(`from [public.]表` の字面)が本文にあるか。 */
function readsTable(body: string, table: string): boolean {
  return new RegExp(`\\bfrom\\s+(?:public\\.)?${escapeRegExp(table.toLowerCase())}\\b`, 'u').test(body);
}

/**
 * 本文の指摘を返す(無ければ空)。
 *
 * @param rawBody migration から引いた本文
 * @param conditions 役の述語の材料(`paidRolePlan` の `conditions`)
 * @param actorTable 条件ごとの、実行者の行を読む表(引けなければ null = 表の字面は見ない)
 * @returns 指摘の並び
 */
export function meterBodyProblems(rawBody: string, conditions: readonly ClaimParts[], actorTable: (condition: ClaimParts) => string | null): string[] {
  const body = normalizeSql(rawBody);
  const problems: string[] = [];
  const write = firstWrite(body);
  for (const condition of conditions) {
    const found = conditionPattern(condition).exec(body);
    const shown = shownCondition(condition);
    if (found === null) {
      problems.push(`役の述語 \`${shown}\` が本文にありません(口の関門を迂回されたとき、RPC が役を持たない実行者を落とせません)`);
    } else if (write >= 0 && found.index > write) {
      problems.push(`役の述語 \`${shown}\` が最初の書き込みより後にあります(落とす前に消費してしまいます)`);
    }
    const table = actorTable(condition);
    if (table !== null && !readsTable(body, table)) problems.push(`実行者の行(${table})を読んでいません(役の述語を DB の行に当てていません。セッションの写しは遅れます)`);
  }
  if (!/\braise exception\b/u.test(body)) problems.push('役を持たない実行者を `raise exception` で落としていません');
  if (!ATOMIC.some((pattern) => pattern.test(body))) {
    problems.push('消費が 1 文の原子的な更新ではありません(`insert … on conflict … do update … where` か `update … set … where … returning`。読んでから足す形は隙間で上限を越えられます)');
  }
  return problems;
}
