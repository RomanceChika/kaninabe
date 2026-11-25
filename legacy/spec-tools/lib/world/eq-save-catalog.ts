/**
 * 保存点の一致の証明(`decideStep` ⇔ 複合 RPC)の**対象の目録**(束 ⑳-5a2)。
 *
 * 単発の操作の目録(`eq-catalog.ts`)と同じ役目である —— 生成物 3 つ(設計図 / ユースケース
 * ごとのテスト / usecase_spec の `test_cases`)と検査 1 つ(T11)が、「どの保存点を実行するか」と
 * 「実行できない保存点はなぜか」を**同じ答え**で知るための 1 か所。4 か所が別々に判定すると
 * 「テストは生成されたのにテストケースの宣言が無い」という静かな割れ方が入る。
 *
 * 対象は**実行計画が導出できた保存点**である(導出できないものは Y1 / Y8 / Y10 が先に止める)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../model/data/types.js';
import type { UsecaseSpec, UsecaseSpecModel } from '../model/usecase/types.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import { buildSavePlans } from '../usecase/plan-build.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import type { EqSaveCases } from './eq-save-cases.js';
import { eqSaveCasesOf } from './eq-save-cases.js';
import type { EqSaveWorld } from './eq-save-world.js';
import { buildEqSaveWorld } from './eq-save-world.js';

/** 保存点 1 つぶんの結果。 */
export type EqSaveResult =
  | { readonly ok: true; readonly world: EqSaveWorld; readonly cases: EqSaveCases }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** 目録の 1 行。 */
export interface EqSaveCatalogEntry {
  /** 保存点の鍵(`{ユースケース名}.{保存点 ID}`。実行計画の鍵と同じ)。 */
  readonly key: string;
  readonly usecase: UsecaseSpec;
  readonly save: string;
  /**
   * 組み立て済みの保存点。
   *
   * 結果表(束 ⑳-5b)が手順ごとに engine へ照会するのに要る —— 目録が「どれを実行するか」と
   * 同じ順で材料も運ぶことで、表と証明が別の計画を読む形を塞ぐ。
   */
  readonly built: BuiltSave;
  readonly result: EqSaveResult;
}

/** 目録を作るのに要る入力(生成器と検査器が同じものを渡す)。 */
export interface EqSaveCatalogInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly usecases: UsecaseSpecModel | undefined;
}

/**
 * 実行計画が導出できた全保存点について、world と組み合わせを組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・usecase_spec
 * @returns 保存点の鍵の順の目録
 */
export function eqSaveCatalog(input: EqSaveCatalogInput): readonly EqSaveCatalogEntry[] {
  const built = buildSavePlans({
    domain: input.domain,
    guards: input.guards,
    actions: input.actions ?? null,
    dataTables: input.dataTables,
    usecases: input.usecases,
  });
  const tables = input.dataTables?.tables ?? [];
  return [...built.saves]
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    .map((save) => entryOf(input.domain, tables, save));
}

/** 保存点の鍵。 */
function keyOf(save: BuiltSave): string {
  return `${save.usecase.name}.${save.plan.save.id}`;
}

/** 保存点 1 つぶんの目録の行。 */
function entryOf(
  domain: SpecModel,
  tables: readonly DataTableSpec[],
  built: BuiltSave,
): EqSaveCatalogEntry {
  const base = { key: keyOf(built), usecase: built.usecase, save: built.plan.save.id, built };
  const world = buildEqSaveWorld({ domain, tables, built });
  if (!world.ok) return { ...base, result: { ok: false, problems: world.problems } };
  return {
    ...base,
    result: {
      ok: true,
      world: world.world,
      cases: eqSaveCasesOf({ domain, tables, built }, world.world),
    },
  };
}

/**
 * そのユースケースの n 番目のテストケース ID(1 始まり)。
 *
 * `UC` の後ろがユースケース名なのは、保存点の一致の証明が**ユースケース 1 枚に 1 ファイル**
 * (中は保存点ごとの節)だからである。区切りが `_` なのはテストケース ID の文法
 * (`TC-{X}-{Y}-{連番}`。`parse-test-case.ts` の `TC_ID`)が区切りを 3 つに固定しているためで、
 * `TC-EQ-UC-{名前}-{連番}` は 4 つになって通らない。
 */
export function eqSaveTestCaseIdOf(usecase: string, index: number): string {
  return `TC-EQ-UC_${usecase.toUpperCase()}-${String(index).padStart(4, '0')}`;
}
