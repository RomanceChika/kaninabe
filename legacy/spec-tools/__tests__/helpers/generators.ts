/**
 * テストが使う「全部入りの生成器の一覧」(コアの生成器 + 選んだ後段が登録した生成器)。CLI の `generate` が回すのと同じ合成。
 * 生成器の全部を import するので、設定や後段の値だけが要るテストは `platform.ts` を使う(こちらを読まない)。
 */

import type { DocGenerator } from '../../lib/gen-kit/generator.js';
import { allGenerators } from '../../lib/compose/all-generators.js';
import { targetGenerators } from '../../lib/target-api/contract.js';
import type { Target } from '../../lib/target-api/contract.js';
import { TEST_TARGETS } from './platform.js';

/**
 * 全部入りの生成器の一覧。
 *
 * @param targets 選ぶ後段(省略は本番と同じ全部入り)
 */
export function testGenerators(targets: readonly Target[] = TEST_TARGETS): readonly DocGenerator[] {
  return allGenerators(targetGenerators(targets));
}
