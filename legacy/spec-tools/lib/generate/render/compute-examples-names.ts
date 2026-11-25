/**
 * 計算値の例の表から生成するテストの**名前**(ファイル・テストケース ID)の唯一の置き場。
 *
 * 生成テスト本体(`code-compute-examples.ts`)・action_spec の `test_cases` の生成ブロック
 * (`action-compute-example-cases.ts`)が同じ綴りを組み立てる。綴りの正が分かれると「仕様が指すテスト」と
 * 「実在するテスト」がすれ違うので、`operation-test-names.ts` と同じ流儀でここ 1 か所に置く。
 *
 * **テストのファイルの置き場(と余分なファイルの検出の走査の根)はここに無い**(部品化 ③-c3 で、置き場の配置の役割
 * `compute-example-test` へ移した。引く口は `test-placement.ts`・走査の根は配置の逆引き `layoutScan`)。
 */

import { splitOperation } from './operation-app-names.js';

/**
 * 例の表のテストケース ID の通し番号の始まり。
 *
 * 手書きのケース(001〜)と、実行計画から生成する場面(`operation-test-names.ts` の 901〜)の
 * **どちらにも当たらない帯**を使う。1 つの操作に置ける例は 99 行までである(`COMPUTE_EXAMPLE_LIMIT_PER_OPERATION`。V18 が見る)。
 */
export const COMPUTE_EXAMPLE_TC_BASE = 800;

/** 例の表のテストケース ID(`TC-{集約}-{イベント}-{800 + n}`。n は操作の中の通し番号で 1 から)。 */
export function computeExampleTcIdOf(op: string, index: number): string {
  const { aggregate, event } = splitOperation(op);
  return `TC-${aggregate.toUpperCase()}-${event.toUpperCase()}-${COMPUTE_EXAMPLE_TC_BASE + index}`;
}
