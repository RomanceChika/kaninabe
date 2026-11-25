/**
 * 生成テストの**テストケース ID** の唯一の置き場(束 ⑰-3)。
 *
 * 同じ綴りを 3 か所が組み立てる —— 生成テスト本体(`code-operation-tests.ts`)、
 * action_spec の `test_cases` の生成ブロック(`action-test-cases.ts`)、そして A6 の突合である。
 * 綴りの正が 2 つになると「仕様が指すテスト」と「実在するテスト」がすれ違うので、
 * `operation-app-names.ts` と同じ流儀でここ 1 か所に置く。
 *
 * **生成テストのファイルの置き場はここに無い**(部品化 ③-c3 で、置き場の配置の役割 `operation-test` へ移した。引く口は `test-placement.ts`)。
 */

import { splitOperation } from './operation-app-names.js';

/**
 * 生成テストの通し番号の始まり。
 *
 * **手書きのテストケース ID と番号帯を分ける**ためにここから振る。同じ操作の統合テストは
 * 人が書いたままであり(実 DB が要る確認は仕様から作れない)、その連番と衝突すると
 * A9(ID の一意性)が落ちる。3 桁に収まる範囲で、手書きが到達しない帯を選んである。
 */
export const GENERATED_TC_BASE = 900;

/** 生成テストのテストケース ID(`TC-{集約}-{イベント}-{900+n}`)。 */
export function testCaseIdOf(op: string, index: number): string {
  const { aggregate, event } = splitOperation(op);
  return `TC-${aggregate.toUpperCase()}-${event.toUpperCase()}-${GENERATED_TC_BASE + index}`;
}
