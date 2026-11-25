/**
 * `test_cases[].spec_ids` が指せる仕様 ID の集合を作る純粋モジュール(読み取り側)。
 *
 * `spec_ids` は「このテストが何を守っているか」の宣言であり、存在しない ID を書けば
 * 宣言は静かに無意味になる(誰も気づかないまま「守っている」ことになる)。
 * 読み取りのテストが指せるのは次の 3 種で、これが値域である
 * (query-spec-writing.md §test_cases)。
 *
 * - query_spec の `id`(例: `query-workshop-list`)
 * - access_spec の `id`(例: `entry-access`)— 可視性そのものを守るテスト
 * - 不変条件 ID(例: `INV-ENTRY-001`)
 *
 * **ドメインイベント ID は書き込み側(action_spec の A8)専用であり、ここには含めない。**
 * 読み取りは状態を動かさないので「このテストが entry.submit を守っている」は成り立たず、
 * 書けてしまうと「イベントのテストがある」という A7 側の見え方を濁らせる。
 */

import type { SpecModel } from '../model/types.js';
import type { QuerySpecModel } from '../model/query/types.js';

/**
 * 参照可能な仕様 ID をすべて集める。
 *
 * @param domain ドメイン仕様全体
 * @param queries query_spec 全体
 * @returns 参照可能な ID の集合
 */
export function collectKnownSpecIds(
  domain: SpecModel,
  queries: QuerySpecModel,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const query of queries.queries) ids.add(query.id);
  for (const specs of domain.aggregates.values()) {
    const accessId = specs.access?.id;
    if (accessId !== undefined) ids.add(accessId);
    for (const invariant of specs.invariants?.invariants ?? []) ids.add(invariant.id);
  }
  return ids;
}
