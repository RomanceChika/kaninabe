/**
 * T18 **`composite` の関数が執行点になる規則の宣言**(`functions[].enforces`)の検査。
 *
 * ADR-0014 の要求:
 *   - `enforces` を書けるのは `kind: rpc` + `shape: composite` の関数だけである(定型の `update` は
 *     本文が `writes` から生成されるので、執行点は宣言なしに仕様から出る)。
 *   - 名指す `writes` のエンティティが access_spec に実在し、その `writes` に `by` の規則が実在する
 *     (存在しない規則を守ると宣言していても、何も守っていない)。
 *   - `test_case`(見張りテストの id)が**その関数の表の `test_cases` に実在する**
 *     (見張りテストを宣言していない手写しは宣言ではない。`@tc` との 3 段の突合は T3 がそのまま見る)。
 *   - 同じ規則を 2 つの宣言が名指ししない(執行点は 1 つ。warning ではなく error —— どちらの本文が正か
 *     決まらない宣言は、読み物ですらない)。
 *
 * `enforces` の**形**(要素のキーの欠落・余計なキー)はパーサー(T0)が見る。ここは意味だけを見る。
 * 見るのは宣言と access_spec の突合であり、`composite` の本文が規則を実際に守っているかは見ない ——
 * それは見張りテストが担う(ADR-0014 の代償)。判定の結果を A18 が読む(`lib/semantics/composite-enforces.ts`)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { enforcesProblemWords } from '../../messages/messages-enforces.js';
import type { EnforcesProblem } from '../../messages/messages-enforces.js';
import type { DataFunctionDecl, DataFunctionEnforces, DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T18';

/**
 * 全 data_table の `enforces` を、access_spec と表の `test_cases` に突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル(`writes` の規則の実在を引く)
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyCompositeEnforces(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  const first = new Map<string, string>();
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      (fn.enforces ?? []).forEach((item, index) => {
        const problem = problemOf(domain, table, fn, item, first);
        if (problem === null) return;
        const words = enforcesProblemWords(problem);
        findings.push({
          verifier: VERIFIER_ID,
          severity: 'error',
          message: words.message,
          location: { ...table.location, pointer: `functions.${fn.name}.enforces[${index}]` },
          suggestion: words.suggestion,
          counterexample: counterexampleOf(fn, item),
        });
      });
    }
  }
  return findings;
}

/** 宣言 1 つの書き間違い(無ければ null)。最初に当たったものを 1 つだけ返す。 */
function problemOf(
  domain: SpecModel,
  table: DataTableSpec,
  fn: DataFunctionDecl,
  item: DataFunctionEnforces,
  first: Map<string, string>,
): EnforcesProblem | null {
  if (fn.kind !== 'rpc' || fn.shape !== 'composite') {
    return { kind: 'wrong_place', function: fn.name, fnKind: fn.kind, shape: fn.shape ?? '' };
  }
  const withWrites = [...domain.aggregates.values()].flatMap((specs) =>
    specs.access === undefined || specs.access.writes.length === 0 ? [] : [specs.access],
  );
  const access = withWrites.find((candidate) => candidate.entity === item.writes);
  if (access === undefined) {
    return { kind: 'unknown_entity', function: fn.name, writes: item.writes, known: withWrites.map((found) => found.entity) };
  }
  if (!access.writes.some((rule) => rule.by === item.by)) {
    return {
      kind: 'no_rule',
      function: fn.name,
      writes: item.writes,
      by: item.by,
      declared: [...new Set(access.writes.map((rule) => rule.by))],
    };
  }
  if (!table.testCases.some((testCase) => testCase.id === item.testCase)) {
    return { kind: 'no_test_case', function: fn.name, table: table.table, testCase: item.testCase };
  }
  const key = `${item.writes}\u0000${item.by}`;
  const earlier = first.get(key);
  if (earlier !== undefined) {
    return { kind: 'duplicate', function: fn.name, writes: item.writes, by: item.by, first: earlier };
  }
  first.set(key, fn.name);
  return null;
}

/** 反例(どの関数のどの宣言か)。 */
function counterexampleOf(fn: DataFunctionDecl, item: DataFunctionEnforces): Record<string, string> {
  return { function: fn.name, writes: item.writes, by: item.by, test_case: item.testCase };
}
