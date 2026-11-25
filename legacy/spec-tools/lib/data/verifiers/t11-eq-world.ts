/**
 * T11 一致の証明(engine ⇔ RPC)の生成可否チェック(束 ⑳-5a)。
 *
 * ⑳-5a は「操作を全組み合わせで実 DB で実行し、engine の判定と一致するか」を確かめるテストを
 * 生成する。ただし**行を置けない集約がある** —— 執行点(トリガ・CHECK)の条件が DSL 外だったり、
 * 数の上限・状態依存のように 1 行では満たせない形だったり、行の参照先をトリガが決めていたり
 * する集約である。
 *
 * そういう集約は生成しない。**黙って飛ばさないのがこの検査器の仕事である** —— 生成物が無い
 * ことは「その操作は engine と DB の一致を実測していない」と同じなので、理由が verify の出力に
 * 残らないと、あとから読む人には「たまたま抜けているのか、原理的に無理なのか」が区別できない。
 * したがって severity は **warning**(仕様の誤りではない。world を宣言から作れないという事実の
 * 報告である)。T8 とまったく同じ構えであり、判定の中身(`rowProblems`)も同じ関数から出る。
 *
 * 対処は 2 つある。(a) その集約の操作は**手書きの差分テスト**が受け持つ(`entry` の
 * `rpc-engine-equivalence.test.ts` がその形)。(b) 執行点の条件を形式定義(`formal`)で
 * 宣言し直して、world を作れるようにする。
 *
 * 判定は生成器とまったく同じ関数(`eqCatalog`)から出る —— 検査と生成が別の規則で決めると、
 * 「検査は通ったのに生成されない」という最も気づきにくい割れ方になる。
 *
 * **保存点(複合 RPC)も同じ問いを立てる**(束 ⑳-5a2)。数える単位が「集約の操作」ではなく
 * 「保存点」になるだけで、判定も対処も同じである —— world に置く行が宣言から作れなければ、
 * その保存点の手順ごとの一致は実測していない。ただし**保存点が作る集約の行は見ない**
 * (それは保存点自身が作るので、置く必要が無い)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { UsecaseSpecModel } from '../../model/usecase/types.js';
import { type EqCatalogInput, eqCatalog, eqSaveCatalog, remedyOf } from '../../world/index.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T11';

/**
 * 対処の一文(**一致の証明のもの**)。
 *
 * 判定は T8(RLS)と同じ関数から出るが、**受け持ちが違う** —— 生成した挙動テストが実行しない
 * のは RLS ではなく「この集約の操作の一致」であり、代わりに受け持つのも手書きの RLS テスト
 * ではなく手書きの差分テストである。T8 の文言をそのまま流すと、verify の出力だけが RLS の
 * 話をする(束 ⑳-5a の独立レビュー 4-a の実測)。
 */
const EQ_REMEDY =
  'この集約の操作の一致は生成した証明では実行しない —— 手書きの差分テスト' +
  '(rpc-engine-equivalence.test.ts の形)が受け持つ';

/**
 * 対処の一文(**保存点のもの**)。
 *
 * 受け持つのは手書きの保存点のテスト(`__tests__/usecase/**`。Y9 が存在を義務づける 2 本)である。
 */
const SAVE_REMEDY =
  'この保存点の手順ごとの一致は生成した証明では実行しない —— 手書きの保存点のテストが受け持つ';

/**
 * 実行計画を導出できた操作のうち、一致の証明の world を作れない集約を報告する。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・ジョブカタログ
 * @returns 生成できない集約の Finding(warning)
 */
export function verifyEqWorlds(input: EqCatalogInput & { readonly usecases?: UsecaseSpecModel }): Finding[] {
  return [...verifyOperationWorlds(input), ...verifySaveWorlds(input)];
}

/** 保存点の world を宣言から作れないものを報告する。 */
function verifySaveWorlds(input: EqCatalogInput & { readonly usecases?: UsecaseSpecModel }): Finding[] {
  if (input.usecases === undefined) return [];
  return eqSaveCatalog({ ...input, usecases: input.usecases }).flatMap((entry) => {
    if (entry.result.ok) return [];
    return entry.result.problems.map((problem) => ({
      verifier: VERIFIER_ID,
      severity: 'warning' as const,
      message: `${problem.message}(保存点 ${entry.key} の一致の証明を生成しません)`,
      location: { ...entry.usecase.location, pointer: `saves.${entry.save}` },
      suggestion: remedyOf(problem.fact, SAVE_REMEDY),
      counterexample: { ...problem.counterexample, save: entry.key },
    }));
  });
}

/** 集約ごとの world を宣言から作れないものを報告する。 */
function verifyOperationWorlds(input: EqCatalogInput): Finding[] {
  return eqCatalog(input).flatMap((entry) => {
    if (entry.result.ok || entry.table === undefined) return [];
    const table = entry.table;
    return entry.result.problems.map((problem) => ({
      verifier: VERIFIER_ID,
      severity: 'warning' as const,
      message: `${problem.message}(${entry.ops.length} 操作の一致の証明を生成しません)`,
      location: { ...table.location, pointer: 'entity' },
      suggestion: remedyOf(problem.fact, EQ_REMEDY),
      counterexample: { ...problem.counterexample, operations: entry.ops.join(' / ') },
    }));
  });
}
