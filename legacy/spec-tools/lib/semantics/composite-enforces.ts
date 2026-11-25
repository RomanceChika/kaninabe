/**
 * `functions[].enforces`(`composite` の関数が「どの `writes` の規則の執行点か」の宣言)を引く意味解析の層。
 *
 * **A18(`writes` の執行点)が読む。** T18(宣言の書き間違いの検査)は宣言そのものを読むので、ここは通さない。
 * 判定を A18 の外に置くのは、変異の目録(`lib/mutation/exemptions.ts`)も `unenforcedWriteRules` を読むためで、
 * 「どの宣言が執行点として数えられるか」を 1 か所にしておく(同じ判定を 2 か所に書くと片方だけが直る)。
 *
 * 数えるのは**書き間違えていない宣言だけ**である —— `kind: rpc` + `shape: composite` の関数が書き、
 * 見張りテストの id が**その関数の表の `test_cases` に実在する**もの。見張りテストを宣言していない
 * 手写しは宣言ではない(A18 の既存の線と同じ)。書き間違いは T18 が error にするので、ここは黙って数えない。
 */

import type { DataTableSpec } from '../model/data/types.js';

/** 執行点として数える宣言 1 つ(どの表のどの関数が、どの規則を、どの見張りテストで守るか)。 */
export interface CompositeEnforcement {
  readonly table: string;
  readonly function: string;
  readonly writes: string;
  readonly by: string;
  readonly testCase: string;
}

/**
 * 執行点として数える `enforces` の宣言をすべて挙げる。
 *
 * @param tables 読み込み済みの data_table
 * @returns 宣言の出現順(表の順 → 関数の順 → 要素の順)
 */
export function compositeEnforcements(tables: readonly DataTableSpec[]): readonly CompositeEnforcement[] {
  const found: CompositeEnforcement[] = [];
  for (const table of tables) {
    for (const fn of table.functions) {
      if (fn.kind !== 'rpc' || fn.shape !== 'composite') continue;
      for (const item of fn.enforces ?? []) {
        if (!table.testCases.some((testCase) => testCase.id === item.testCase)) continue;
        found.push({ table: table.table, function: fn.name, writes: item.writes, by: item.by, testCase: item.testCase });
      }
    }
  }
  return found;
}

/**
 * そのエンティティの `by` の規則を執行点として名指ししている宣言(あれば最初の 1 つ)。
 *
 * @param enforcements `compositeEnforcements` の結果
 * @param entity access_spec のエンティティ
 * @param by `writes` の規則の `by`
 * @returns 名指ししている宣言。無ければ undefined
 */
export function enforcementOf(
  enforcements: readonly CompositeEnforcement[],
  entity: string,
  by: string,
): CompositeEnforcement | undefined {
  return enforcements.find((item) => item.writes === entity && item.by === by);
}
