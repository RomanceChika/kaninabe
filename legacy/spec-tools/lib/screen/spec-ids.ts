/**
 * `test_cases[].spec_ids` が指せる仕様 ID の集合を作る純粋モジュール(画面側)。
 *
 * `spec_ids` は「このテストが何を守っているか」の宣言であり、存在しない ID を書けば
 * 宣言は静かに無意味になる(誰も気づかないまま「守っている」ことになる)。
 * 画面テストが指せるのは次の 4 種で、これが値域である
 * (screen-spec-writing.md §test_cases)。
 *
 * - `screen_spec` の `id`(例: `screen-workshop-detail`)— 画面の配線そのものを守るテスト
 * - `chrome_spec` の `id`(例: `chrome-member`)— 共有クロームの骨格を守るテスト
 * - `query_spec` の `id`(例: `query-workshop-list`)— その画面が読む経路を守るテスト
 * - ドメインイベント ID(例: `entry.submit`。予約 ID を含む)— その画面が発火する操作
 *
 * **access_spec の id と不変条件 ID は含めない。** 可視性と不変条件を守っているのは RLS と
 * DB 制約であって画面ではなく、画面テスト(偽のクエリ結果を渡す)からは 1 ミリも確かめられない。
 * 書けてしまうと「守られている」という見え方だけが増える。
 */

import type { SpecModel } from '../model/types.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import { listCreates, listDeletes, listEvents, listUpdates } from '../semantics/domain-index.js';

/**
 * 参照可能な仕様 ID をすべて集める。
 *
 * @param domain ドメイン仕様全体
 * @param queries query_spec 全体
 * @param screens screen_spec / chrome_spec 全体
 * @returns 参照可能な ID の集合
 */
export function collectScreenSpecIds(
  domain: SpecModel,
  queries: QuerySpecModel,
  screens: ScreenSpecModel,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const screen of screens.screens) ids.add(screen.id);
  for (const chrome of screens.chromes) ids.add(chrome.id);
  for (const query of queries.queries) ids.add(query.id);
  for (const event of listEvents(domain)) ids.add(event.id);
  for (const entry of listCreates(domain)) ids.add(entry.id);
  for (const entry of listDeletes(domain)) ids.add(entry.id);
  for (const entry of listUpdates(domain)) ids.add(entry.id);
  return ids;
}
