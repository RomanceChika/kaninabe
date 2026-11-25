/**
 * 索引候補の前方一致の畳み込み(`index-derivation.ts` が使う純粋モジュール)。
 *
 * 候補の出どころ(query_spec / 関数の `lookup`)に依らず、同一テーブルの候補どうしを列数の多い順に見て、
 * 短い方が長い方の**前方一致(先頭から連続一致)**であれば長い方に畳む。要求元(query 名・関数名と位置)は
 * 畳んだ先に集約する。
 */

import type { IndexOrigin, IndexRequirement } from './types.js';

/** 畳み込み前の候補 1 本(列の並び + 要求元)。 */
export interface RawCandidate {
  readonly columns: readonly string[];
  readonly origins: readonly IndexOrigin[];
}

/** `short` が `long` の前方一致(先頭から連続一致)であるか。 */
function isPrefix(short: readonly string[], long: readonly string[]): boolean {
  if (short.length > long.length) return false;
  return short.every((column, index) => column === long[index]);
}

/** 名前を昇順(既定の文字列順)にそろえる。 */
function sortedNames(origins: readonly IndexOrigin[], kind: IndexOrigin['kind']): string[] {
  return [...new Set(origins.filter((origin) => origin.kind === kind).map((origin) => origin.name))].sort();
}

/** 種類の並び順(query が先)。 */
const KIND_ORDER: Readonly<Record<IndexOrigin['kind'], number>> = { query: 0, lookup: 1 };

/** 要求元を「種類(query が先)・名前」の順にそろえ、同じ種類・名前の重複を 1 件にする(先に来たものを残す)。 */
function sortedOrigins(origins: readonly IndexOrigin[]): IndexOrigin[] {
  const unique = new Map<string, IndexOrigin>();
  for (const origin of origins) {
    const key = `${origin.kind}\u0000${origin.name}`;
    if (!unique.has(key)) unique.set(key, origin);
  }
  // 重複を除いた後なので、同じ種類で名前が等しい組は無い(比べた結果が 0 になる組が無い)。
  return [...unique.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.name < b.name ? -1 : 1));
}

/**
 * 1 テーブル分の生候補を前方一致で畳む(列数の多い順に見て、短い方を長い方へ吸収する)。
 *
 * @param table 候補を持つテーブル
 * @param raw そのテーブルの生候補
 */
export function foldTable(table: string, raw: readonly RawCandidate[]): IndexRequirement[] {
  const sorted = [...raw].sort((a, b) => {
    if (b.columns.length !== a.columns.length) return b.columns.length - a.columns.length;
    return a.columns.join('\u0000').localeCompare(b.columns.join('\u0000'));
  });
  const accepted: { readonly columns: readonly string[]; origins: IndexOrigin[] }[] = [];
  for (const candidate of sorted) {
    const parent = accepted.find((entry) => isPrefix(candidate.columns, entry.columns));
    if (parent !== undefined) {
      parent.origins.push(...candidate.origins);
      continue;
    }
    accepted.push({ columns: candidate.columns, origins: [...candidate.origins] });
  }
  return accepted.map((entry) => ({
    table,
    columns: entry.columns,
    queries: sortedNames(entry.origins, 'query'),
    lookups: sortedNames(entry.origins, 'lookup'),
    origins: sortedOrigins(entry.origins),
  }));
}
