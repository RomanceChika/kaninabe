/**
 * T8 RLS の挙動テストの生成可否チェック(束 ⑳-4b)。
 *
 * ⑳-4b は「RLS が宣言どおりの行集合を返すか」を実 DB で確かめるテストを生成する。ただし**行を
 * 置けない表がある** —— 執行点(トリガ・CHECK)の条件が DSL 外だったり、数の上限・状態依存の
 * ように 1 行では満たせない形だったり、行の参照先をトリガが決めていたりする表である。
 *
 * そういう表は生成しない。**黙って飛ばさないのがこの検査器の仕事である** —— 生成物が無いことは
 * 「そこは実行されていない」と同じなので、理由が verify の出力に残らないと、あとから読む人には
 * 「たまたま抜けているのか、原理的に無理なのか」が区別できない。したがって severity は
 * **warning**(仕様の誤りではない。world を宣言から作れないという事実の報告である)。
 *
 * 対処は 2 つある。(a) その表の RLS は**手書きの RLS テスト**が受け持つ(いまの題材の製品の姿)。
 * (b) 執行点の条件を形式定義(`formal`)で宣言し直して、world を作れるようにする。
 *
 * 判定は生成器とまったく同じ関数(`rlsWorldCatalog`)から出る —— 検査と生成が別の規則で決めると、
 * 「検査は通ったのに生成されない」という最も気づきにくい割れ方になる。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { rlsWorldCatalog } from '../../world/index.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T8';

/**
 * RLS のポリシーを生成している表のうち、挙動テストの world を作れないものを報告する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 生成できない表の Finding(warning)
 */
export function verifyRlsWorlds(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  return rlsWorldCatalog(domain, dataTables).flatMap((entry) => {
    if (entry.result.ok) return [];
    return entry.result.problems.map((problem) => ({
      verifier: VERIFIER_ID,
      severity: 'warning' as const,
      message: problem.message,
      location: { ...entry.table.location, pointer: 'policies_migration' },
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
    }));
  });
}
