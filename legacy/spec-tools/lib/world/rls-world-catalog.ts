/**
 * RLS の挙動テストの**対象表の目録**(束 ⑳-4b)。
 *
 * 生成物は 3 つ(world の設計図 / 表ごとのテスト / data_table の `test_cases`)、検査は 1 つ(T8)
 * あり、どれも「どの表を実行するか」と「実行できない表はなぜか」を同じ答えで知らなければならない ——
 * 4 か所が別々に判定すると「テストは生成されたのにテストケースの宣言が無い」「検査は通ったのに生成されない」
 * という割れ方が静かに入る。目録はここ 1 つである。
 *
 * 対象は **RLS のポリシーを生成している表**(`policies_migration` を宣言した表)に限る。ポリシーを
 * 生成していない表の挙動を実行しても、確かめているのは手書きの SQL であって宣言ではない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../model/data/types.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import type { RlsWorldResult } from './rls-world.js';
import { buildRlsWorld } from './rls-world.js';

/** 目録の 1 行(その表と、world を作れたかどうか)。 */
export interface RlsWorldEntry {
  readonly table: DataTableSpec;
  readonly result: RlsWorldResult;
}

/**
 * RLS のポリシーを生成している全表について、world を組み立てた結果を表名順に並べる。
 *
 * @param domain ドメイン仕様
 * @param dataTables 読み込み済みの data_table(無い環境では空)
 * @returns 表名順の目録
 */
export function rlsWorldCatalog(
  domain: SpecModel,
  dataTables: DataTableSpecModel | undefined,
): readonly RlsWorldEntry[] {
  const tables = dataTables?.tables ?? [];
  return [...tables]
    .filter((table) => isTarget(table, domain))
    .sort((a, b) => a.table.localeCompare(b.table))
    .map((table) => ({ table, result: buildRlsWorld(table, { domain, tables }) }));
}

/** その表が挙動テストの対象か(ポリシーを生成していて、読み取りの宣言がある)。 */
function isTarget(table: DataTableSpec, domain: SpecModel): boolean {
  if (table.entity === undefined || table.policiesMigration === undefined) return false;
  return findAccessSpec(domain, table.entity) !== null;
}

/** その表の n 番目のテストケース ID(1 始まり)。 */
export function rlsTestCaseIdOf(table: string, index: number): string {
  return `TC-RLS-${table.toUpperCase()}-${String(index).padStart(3, '0')}`;
}
