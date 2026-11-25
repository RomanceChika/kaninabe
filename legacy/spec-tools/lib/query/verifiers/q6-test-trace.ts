/**
 * Q6 テストケースのチェック。
 *
 * query-spec-writing.md の Q6:「`test_cases[].implementation` が実在してテスト側の `@tc` と
 * 一致し、`spec_ids` が実在し(値域は query_spec の id / access_spec の id /
 * 不変条件 ID)、`type: integration` のケースを 1 つ以上持つ」。
 *
 * 3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の一致)は A6 と同じ規則なので
 * lib/testcase/test-trace-match.ts を共用し、突合する宣言はテストケース ID 台帳の
 * `query_spec` エントリから引く(lib/testcase/registry.ts)。逆方向(テストにあるが仕様に無い
 * `@tc` = orphan)は A6 が、ID の一意性は A9 が、どちらも同じ台帳を母集合にして見る。
 *
 * `integration` を要求するのは、読み取りの安全性を担保しているのが**アプリの絞り込みではなく
 * DB の RLS** だからである。ユニットテストだけでは「絞り込みの結果」しか確かめられず、
 * 「見えてはいけない行が見えない」ことは 1 つも保証されない。
 */

import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import type { QueryInput, QuerySpec } from '../../model/query/types.js';
import { collectKnownSpecIds } from '../spec-ids.js';

/** Q6: test_cases が実在するテストに接地し、必要な種別と参照先を持つかを検証する。 */
export const queryTestTraceVerifier: QueryVerifier = {
  id: 'Q6',
  title: 'テストケース — @tc と一致し、spec_ids が実在し、integration を持つ',

  verify(input: QueryInput): Finding[] {
    const known = collectKnownSpecIds(input.domain, input.queries);
    const findings = input.queries.queries.flatMap(checkIntegration);
    for (const entry of input.registry.ofKind('query_spec')) {
      findings.push(...checkSpecIds(entry, known));
    }
    return [...findings, ...matchAnnotations(input)];
  },
};

/** 仕様 → テストの 3 段突合(app/ を走査できているときだけ)。 */
function matchAnnotations(input: QueryInput): Finding[] {
  if (!input.tests.available) return [];
  const byTcId = groupByTcId(input.tests.annotations);
  const testFiles = new Set(input.tests.testFiles);
  return input.registry
    .ofKind('query_spec')
    .flatMap((entry) => checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, 'Q6'));
}

/** RLS を通る経路のテストが 1 つ以上あるか。 */
function checkIntegration(query: QuerySpec): Finding[] {
  if (query.testCases.some((testCase) => testCase.type === 'integration')) return [];
  return [
    queryFinding('Q6', {
      message: `${query.name} に type: integration のテストケースがありません`,
      location: query.location,
      suggestion:
        '実 DB(RLS 有効)に対して読むテストを 1 つ以上足して type: integration で宣言する。' +
        '読み取りの安全性を担保しているのは絞り込みではなく RLS なので、そこを通らないテストでは何も保証できない',
      counterexample: { query: query.name },
    }),
  ];
}

/** spec_ids が実在する仕様を指しているか。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) =>
      queryFinding('Q6', {
        message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
        location: entry.location,
        suggestion:
          `spec_ids に書けるのは query_spec の id(${entry.specId})・access_spec の id・` +
          '不変条件 ID のいずれか。実在する ID に直す' +
          '(ドメインイベント ID は状態を動かす書き込み側の語彙なので、読み取りには書かない)',
        counterexample: { test_case: entry.tcId, spec_id: id },
      }),
    );
}
