/**
 * `test_cases[].spec_ids` が指せるドメイン側の仕様 ID を作る純粋モジュール。
 *
 * `spec_ids` は「このテストが何を守っているか」の宣言であり、存在しない ID を書けば
 * 宣言は静かに無意味になる(誰も気づかないまま「守っている」ことになる)。
 * そのため指せる先は値域とし、実在を機械が検査する(A8 / Q6)。
 *
 * ドメイン側の値域はここが定義する。
 * - ドメインイベント ID(例: `entry.submit`)
 * - 予約 ID(例: `entry.create` / `entry.delete` / `entry.update`)— access_spec に
 *   `creates` / `deletes` / `writes` の宣言があるものだけ(A1 の実在条件と同じ規則)
 * - access_spec の `id`(例: `entry-access`)— 可視性そのものを守るテスト
 * - 不変条件 ID(例: `INV-ENTRY-001`)
 *
 * `query_spec` の `id` を足すのは読み取り側(lib/query/spec-ids.ts)の役目である。
 *
 * **置き場**: ドメイン仕様のモデルだけを読む事実の導出で、A8(action)・Q6・H3・Z1・X4・T3・Y9 が同じ値域を読む。
 * 以前は `lib/trace/` にいて、他の種類の検査が trace のディレクトリを読む形だった(種類の相互依存の一因)ので、
 * ドメインの索引と同じ `lib/semantics/` に置く。
 */

import type { SpecModel } from '../model/types.js';
import { listCreates, listDeletes, listEvents, listUpdates } from './domain-index.js';

/**
 * ドメイン仕様に接地する仕様 ID をすべて集める。
 *
 * @param domain ドメイン仕様全体
 * @returns 参照可能な ID の集合
 */
export function collectDomainSpecIds(domain: SpecModel): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const event of listEvents(domain)) ids.add(event.id);
  for (const entry of listCreates(domain)) ids.add(entry.id);
  for (const entry of listDeletes(domain)) ids.add(entry.id);
  for (const entry of listUpdates(domain)) ids.add(entry.id);
  for (const specs of domain.aggregates.values()) {
    const accessId = specs.access?.id;
    if (accessId !== undefined) ids.add(accessId);
    for (const invariant of specs.invariants?.invariants ?? []) ids.add(invariant.id);
  }
  return ids;
}
