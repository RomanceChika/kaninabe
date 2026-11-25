/**
 * テストケース ID の台帳(全仕様種を横断する 1 つの索引)。
 *
 * テストケース ID(`TC-...`)は、仕様・テストコード・レビュー記録・issue をつなぐ識別子であり、
 * **全仕様を通じて一意**でなければならない(action-spec-writing.md §test_cases)。
 * ところが宣言の場所は仕様種ごとに分かれている(現在は `action_spec` / `query_spec` / `screen_spec`)ため、
 * 「各仕様種が自分の中だけで一意性を見る」形だと**種をまたいだ重複が誰にも見えない**。
 * また「テストの `@tc` に対応する宣言があるか」(orphan 判定)の母集合も、
 * 仕様種が増えるたびに検査へ横渡しする配管が増えていた。
 *
 * 台帳はその 2 つを 1 箇所に集約する。台帳を作るのは CLI で 1 回だけであり、
 * A 群・Q 群・台帳検査(A9)はいずれも**同じ 1 つの台帳**を引数で受け取る。
 *
 * このモジュールは索引の構造だけを持ち、どの仕様種からエントリを作るかは知らない
 * (仕様の型に依存しないため、仕様種が増えてもここは変わらない)。
 * 仕様からエントリを作るのは sources.ts の役目である。
 * 台帳の型(`TcRegistry` / `TcRegistryEntry` / `SpecKind` …)と仕様種の一覧(`SPEC_KIND_LIST`)は語彙の入口 `types.ts` にある(型だけを読む層が値の実装を道連れにしない)。
 */

import type { RetiredTcId, TcRegistry, TcRegistryEntry } from './types.js';

/**
 * エントリ列に索引を張って台帳にする。
 *
 * エントリの作り方は仕様種ごとに違うため、ここでは作り終わったものを受け取るだけにする
 * (sources.ts の `collectTcEntries` が全仕様種ぶんを 1 本の列にする)。
 *
 * @param entries 全仕様種の宣言(宣言順)
 * @param retired 欠番にした ID の宣言(action_spec の `retired:`。省略時は空)
 * @returns 構築済みの台帳
 */
export function buildTcRegistry(
  entries: readonly TcRegistryEntry[],
  retired: readonly RetiredTcId[] = [],
): TcRegistry {
  const byId = new Map<string, TcRegistryEntry[]>();
  for (const entry of entries) {
    const bucket = byId.get(entry.tcId);
    if (bucket === undefined) byId.set(entry.tcId, [entry]);
    else bucket.push(entry);
  }
  return {
    entries,
    has: (tcId) => byId.has(tcId),
    find: (tcId) => byId.get(tcId) ?? [],
    ofKind: (kind) => entries.filter((entry) => entry.specKind === kind),
    duplicates: () =>
      [...byId.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([tcId, group]) => ({ tcId, entries: group })),
    retiredReuses: () =>
      retired
        .map((decl) => ({ tcId: decl.tcId, retiredAt: decl.location, reusedBy: byId.get(decl.tcId) ?? [] }))
        .filter((reuse) => reuse.reusedBy.length > 0),
  };
}
