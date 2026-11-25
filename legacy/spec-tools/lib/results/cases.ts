/**
 * 結果表の**元データ**(単発の操作)—— 一致の証明と同じ列挙を、engine の答えつきで全部並べる
 * (束 ⑳-5b)。
 *
 * 軸は 1 か所(`eq-cases.ts`)であり、**掛け算は実行する側が行う**という取り決めに乗る
 * (設計図は軸と直積の大きさだけを運ぶ)。証明を実行する側(`@kaninabe/runtime/testing/equivalence/expect` の `enumerate`)と
 * ここは、同じ軸を同じ順で掛ける 2 人目の「実行する側」である —— 数が合っていることは
 * 単体テストが見る(`count` と実際に並べた数の一致)。
 *
 * 並べるのは**全列挙**のままである。人が読む表はここから 2 軸に畳んだ姿にすぎず、畳む前の全数を
 * `docs/book/assets/results/` に置くのは「その ✅ はどの組み合わせか」を辿れるようにするためである。
 *
 * 判定は 1 行も書かない —— 形ごとの照会(`decideShape`)もロールの数え方(`arrayActorRoles`)も
 * ガード変数の割り当て(`envOf`)も、**一致の証明が呼ぶのと同じ app の関数**である(⑳-5b-b)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { withActorInputs } from './actor-inputs.js';
import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { EqAxisValue, EqFoldedGuard, EqOperationCases, EqCatalogEntry, EqActor, EqWorld } from '../world/index.js';
import { eqCatalog } from '../world/index.js';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import { SCENARIO_NOW } from '../usecase/plan-scenario-values.js';
import type { BuiltOperation } from '../usecase/operation-plan.js';
import type { EngineTables, ResultDecision } from './decide.js';
import { asResultDecision, engineTablesOf } from './decide.js';
import { appFacts, appRunner, appShape } from './engine-bridge.js';
import { resultResolutionOf, resultRunPlan } from './run-plan.js';
import type { SimulatedSubject, SimulatedValue } from './simulated-world.js';
import { simulatedRowId, simulatedSubjectOf } from './simulated-world.js';

/** ガード変数 1 本の選んだ値。 */
export interface ResultAxisValue {
  readonly key: string;
  readonly label: string;
}

/** 組み合わせ 1 つと、その engine の答え。 */
export interface ResultCase {
  /** 対象の状態(状態を持たない形では null)。 */
  readonly state: string | null;
  /** world の実行者の名前。 */
  readonly actor: string;
  /** ロール配列の名前。 */
  readonly array: string;
  /** 編集で動かす欄(編集以外は null)。 */
  readonly field: string | null;
  readonly axis: readonly ResultAxisValue[];
  readonly decision: ResultDecision;
}

/** 操作 1 つぶんの結果。 */
export interface ResultOperation {
  readonly op: string;
  readonly label: string;
  readonly aggregate: string;
  readonly kind: EqOperationCases['kind'];
  /** その操作の RPC が拒否をどこまで返すか。 */
  readonly enforcement: EqOperationCases['enforcement'];
  /** 設計図が宣言した直積の大きさ。 */
  readonly count: number;
  /** 代表値に畳んだ軸。 */
  readonly folded: readonly string[];
  readonly foldedGuards: readonly EqFoldedGuard[];
  readonly cases: readonly ResultCase[];
}

/** 集約 1 つぶんの結果(world を作れない集約は理由だけを運ぶ)。 */
export interface ResultAggregate {
  readonly aggregate: string;
  /** その集約の操作 ID(world を作れなくても並ぶ)。 */
  readonly ops: readonly string[];
  /** world の実行者(表の行の並び)。 */
  readonly actors: readonly EqActor[];
  readonly operations: readonly ResultOperation[];
  /** world を宣言から作れない理由(作れたときは空)。 */
  readonly problems: readonly string[];
}

/** 結果を組み立てるのに要る入力(目録と同じもの)。 */
export interface ResultCasesInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly jobs: JobSpecModel | undefined;
}

/**
 * 実行計画が導出できた全操作について、全組み合わせの結果を組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・ジョブカタログ
 * @returns 集約名順の結果
 */
export function resultAggregates(input: ResultCasesInput): readonly ResultAggregate[] {
  return resultAggregatesOf(eqCatalog(input), engineTablesOf(input.domain, input.guards, input.actions ?? null));
}

/**
 * **目録(軸)と規則表(判定)を別々に受け取る**口。変異テスト(束 ⑳-5c)は「変異の前の軸で、
 * 変異の後の判定を実行する」—— 軸まで変異させると `by` からロールを落とす変異が world からその
 * 実行者ごと消し、変異が見えなくなる(⑳-5a2 §7 ②)。
 *
 * @param catalog 一致の証明の目録(world と軸)
 * @param tables engine が読む規則表
 * @returns 集約名順の結果
 */
export function resultAggregatesOf(
  catalog: readonly EqCatalogEntry[],
  tables: EngineTables,
): readonly ResultAggregate[] {
  return catalog.map((entry) => aggregateOf(entry, tables));
}

/** 集約 1 つぶんの結果。 */
function aggregateOf(entry: EqCatalogEntry, tables: EngineTables): ResultAggregate {
  if (!entry.result.ok) {
    return {
      aggregate: entry.aggregate,
      ops: entry.ops,
      actors: [],
      operations: [],
      problems: entry.result.problems.map((problem) => problem.message),
    };
  }
  const world = entry.result.world;
  const operations = entry.result.operations.map((cases, index) =>
    operationOf(world, cases, entry.built[index], tables),
  );
  return {
    aggregate: entry.aggregate,
    ops: entry.ops,
    actors: world.actors,
    operations: operations.filter((operation): operation is ResultOperation => operation !== null),
    problems: [],
  };
}

/** 操作 1 つぶんの結果(材料が揃わない操作は落とす)。 */
function operationOf(
  world: EqWorld,
  cases: EqOperationCases,
  built: BuiltOperation | undefined,
  tables: EngineTables,
): ResultOperation | null {
  const step = built?.plan.steps[0];
  const facts = built?.facts.steps[0];
  if (built === undefined || step === undefined || facts === undefined) return null;
  const plan = resultRunPlan({
    usecase: built.plan.usecase.name,
    save: built.plan.save.id,
    rpc: built.plan.rpcName,
    composite: false,
    steps: built.plan.steps,
    facts: built.facts,
    tables,
  });
  const runStep = plan.steps[0];
  if (runStep === undefined) return null;
  return {
    op: cases.op,
    label: cases.label,
    aggregate: cases.aggregate,
    kind: cases.kind,
    enforcement: cases.enforcement,
    count: cases.count - cases.crossCount, // 他のテナントの行の組み合わせ(拒否の表明だけ。`eq-cross-tenant.ts`)は表に並べない
    folded: cases.folded,
    foldedGuards: cases.foldedGuards,
    cases: enumerateCases(world, cases).map((selection) => ({
      ...selection,
      decision: decisionOf(plan, runStep, world, cases, selection),
    })),
  };
}

/**
 * 組み合わせ 1 つの判定(**一致の証明の期待とまったく同じ引数で** app の関数を呼ぶ)。
 *
 * 実行者に立つロールの出発点は**ロール配列**である(実行器の「セッションから解決した閉包」では
 * ない)—— 単発の操作の RPC は `p_actor_roles` をそのまま見るので、証明も表もそこを軸にする。
 */
function decisionOf(
  plan: RunPlan,
  step: RunStepPlan,
  world: EqWorld,
  cases: EqOperationCases,
  selection: Selection,
): ResultDecision {
  const subject = subjectOf(world, cases, selection);
  const resolution = resultResolutionOf({
    plan,
    subject,
    // 単発の形は実行者自身の行をそのまま渡す —— `actor.{欄}` を読むガード式が見るのは行の欄で
    // あり、行が無い人では空になる(一致の証明 `@kaninabe/runtime/testing/equivalence/oracle` の `factValue` と同じ)。
    session: true,
    input: subject.inputs[0] ?? {},
  });
  const { factValue } = appFacts();
  const roles = appShape().arrayActorRoles(step, arrayRolesOf(world, selection), subject.actorId, subject.actorRow, (source) =>
    factValue(plan, source, resolution),
  );
  return asResultDecision(
    appShape().decideShape(step, {
      roles,
      env: appRunner().envOf(plan, step, resolution),
      state: selection.state ?? '',
      field: selection.field,
    }),
  );
}

/** 組み合わせ 1 つ(判定の前の姿)。 */
type Selection = Omit<ResultCase, 'decision'> & { readonly placements: readonly EqAxisValue[] };

/**
 * 軸の直積(状態 × 実行者 × ロール配列 × 編集の欄 × ガード変数)。
 *
 * 並べる順は**証明を実行する側**(`@kaninabe/runtime/testing/equivalence/expect` の `enumerate`)と
 * 同じである —— 同じ軸を同じ順で掛けるので、n 番目の組み合わせが両者で同じものを指す。
 * world に居ない実行者・その人が渡せない配列を飛ばすのも同じ 2 行である。
 */
function enumerateCases(world: EqWorld, cases: EqOperationCases): readonly Selection[] {
  const selections: Selection[] = [];
  for (const state of cases.states) {
    for (const key of cases.actors) {
      const actor = world.actors.find((candidate) => candidate.key === key);
      if (actor === undefined) continue;
      for (const array of cases.arrays) {
        if (!actor.arrays.some((candidate) => candidate.name === array)) continue;
        for (const field of cases.fields) {
          for (const placements of axisCombinations(cases)) {
            selections.push({
              state,
              actor: key,
              array,
              field,
              axis: cases.axes.map((axis, index) => ({
                key: axis.key,
                label: placements[index]?.label ?? '',
              })),
              placements,
            });
          }
        }
      }
    }
  }
  return selections;
}

/** ガード変数の軸の直積(軸が無ければ 1 通り)。 */
function axisCombinations(cases: EqOperationCases): readonly (readonly EqAxisValue[])[] {
  let rows: EqAxisValue[][] = [[]];
  for (const axis of cases.axes) {
    const next: EqAxisValue[][] = [];
    for (const row of rows) {
      for (const value of axis.values) next.push([...row, value]);
    }
    rows = next;
  }
  return rows;
}

/** その組み合わせで実行する相手(シミュレーション上の world)。 */
function subjectOf(
  world: EqWorld,
  cases: EqOperationCases,
  selection: Selection,
): SimulatedSubject {
  const actor = world.actors.find((candidate) => candidate.key === selection.actor);
  const branch = actor?.target ?? world.actors.find((candidate) => candidate.target !== null)?.target ?? '';
  const root = world.rows.find((row) => row.key === branch);
  const input: Record<string, SimulatedValue> = { ...cases.inputs, ...(root?.values ?? {}) };
  for (const [column, key] of Object.entries(root?.refs ?? {})) input[column] = simulatedRowId(key);
  return withActorInputs(simulatedSubjectOf({
    rows: world.rows,
    branches: [branch],
    actorRow: actor?.row ?? null,
    actorKey: selection.actor,
    actorEntities: cases.actorReads,
    placements: selection.placements.flatMap((value) => value.placements),
    state:
      cases.stateColumn === null || selection.state === null
        ? null
        : { entity: cases.aggregate, column: cases.stateColumn, value: selection.state },
    inputs: [input],
    now: SCENARIO_NOW,
  }), selection.placements, world);
}

/** その組み合わせで渡すロール配列の中身。 */
function arrayRolesOf(world: EqWorld, selection: Selection): readonly string[] {
  const actor = world.actors.find((candidate) => candidate.key === selection.actor);
  return actor?.arrays.find((array) => array.name === selection.array)?.roles ?? [];
}
