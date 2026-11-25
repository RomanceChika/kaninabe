/**
 * 結果表が実行器に渡す**実行計画**と**判断材料**(束 ⑳-5b-b)。
 *
 * 結果表は判定を app の実行器から借りる(`engine-bridge.ts`)。実行器が読むのは実行計画
 * (`RunPlan`)と判断材料(`Resolution`)の 2 つだけなので、docs はその 2 つを仕様から組んで渡す。
 *
 * - **計画の値は生成器と同じ 1 か所**から出る(`usecase/step-plan-data.ts` の `runStepData`)。
 *   生成物(`usecase-plans.ts` / `operation-plans.ts`)はその字面であり、ここは同じ値の
 *   オブジェクトである —— 製品の生成物を読まないので、4 題材でもそのまま動く
 *   (**ホストの語は 1 つも入らない**。処理中の仕様から出た値しか載らない)。
 * - **判断材料はシミュレーション上の world から**取る(`simulated-world.ts`)。実行器が実 DB から読むところ
 *   (`loadFacts`)を、置き直したあとの world から取るだけで、読む列を決めるのは計画の `reads`
 *   である —— 一致の証明(`@kaninabe/runtime/testing/save/world` の `factsOf`)と同じ形。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SaveFacts } from '../usecase/plan-facts.js';
import type { SaveStepPlan } from '../usecase/step-plan.js';
import { runStepData } from '../usecase/step-plan-data.js';
import type { GuardValue } from '@kaninabe/runtime/engine';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { Resolution } from '@kaninabe/runtime/template/evaluate';
import type { EngineTables } from './decide.js';
import type { SimulatedSubject, SimulatedValue } from './simulated-world.js';

/** 実行計画を組むのに要るもの(接地済みの手順と解決済みの事実)。 */
export interface ResultPlanInput {
  /** 保存点ならユースケース名、単発の操作なら状態機械名(または集約名)。 */
  readonly usecase: string;
  /** 保存点なら保存点 ID、単発の操作ならイベント名。 */
  readonly save: string;
  /** 呼ぶ RPC の名前。 */
  readonly rpc: string;
  /** 複合 RPC か(保存点は true、単発の操作は false)。 */
  readonly composite: boolean;
  readonly steps: readonly SaveStepPlan[];
  readonly facts: SaveFacts;
  readonly tables: EngineTables;
}

/**
 * 仕様から実行計画を組む(生成物と同じ値の、字面になる前の姿)。
 *
 * 名前付き引数(`call.params`)だけは**空で渡す** —— 引数の並びは RPC を呼び出すときの話であり、
 * `permit` を立てる段は 1 つも読まない(結果表は RPC を呼び出さない)。
 *
 * @param input 接地済みの手順・解決済みの事実・規則表
 * @returns 実行器が読む実行計画
 */
export function resultRunPlan(input: ResultPlanInput): RunPlan {
  return {
    usecase: input.usecase,
    save: input.save,
    rpc: input.rpc,
    call: input.composite ? { kind: 'composite' } : { kind: 'named', params: [] },
    reads: input.facts.reads.map((read) => ({ ...read })),
    expectedKeys: [...input.facts.expectedKeys],
    steps: input.steps.map((step, index) => runStepPlanOf(step, input.facts.steps[index], input.tables)),
    invariantHooks: [...input.facts.invariantHooks],
    result: { ...input.facts.result },
  };
}

/** 手順 1 つ(値は生成器と同じ 1 か所から、規則表は仕様から組んだ表から)。 */
function runStepPlanOf(
  step: SaveStepPlan,
  facts: SaveFacts['steps'][number] | undefined,
  tables: EngineTables,
): RunStepPlan {
  const data = runStepData(step, facts);
  return {
    ...data,
    createRules: step.kind === 'create' ? (tables.creates.get(step.entity) ?? null) : null,
    deleteRules: step.kind === 'delete' ? (tables.deletes.get(step.entity) ?? null) : null,
    writeRules: step.kind === 'update' ? (tables.writes.get(step.entity) ?? null) : null,
    machine: step.machine === null ? null : (tables.machines.get(step.machine.machine) ?? null),
  };
}

/** 判断材料を組むのに要るもの。 */
export interface ResultResolutionInput {
  readonly plan: RunPlan;
  readonly subject: SimulatedSubject;
  /**
   * セッションが実行者のプロフィールを運ぶか。
   *
   * 運ぶのは「人の入口から来て、かつ実行者の集約にその人の行がある」ときだけである ——
   * 既定のログインロールの根拠はその行であり(domain-spec-writing.md §role_spec)、
   * プロフィールはその写しである。
   */
  readonly session: boolean;
  /** 計画への入力(保存点は手順の別名が鍵、単発の操作は欄がそのまま鍵)。 */
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * 実行器に渡す判断材料。
 *
 * @param input 計画・シミュレーション上の world・セッションの有無・入力
 * @returns 読んだ事実・実行者・セッションの欄・入力・判断時刻
 */
export function resultResolutionOf(input: ResultResolutionInput): Resolution {
  const subject = input.subject;
  return {
    facts: factsOf(input.plan, subject),
    actorId: subject.actorId,
    session: input.session ? subject.actorRow : null,
    input: input.input,
    now: subject.now,
  };
}

/** 計画の `reads` が指す列の値(置き直したあとのシミュレーション上の world から取る)。 */
function factsOf(plan: RunPlan, subject: SimulatedSubject): Readonly<Record<string, GuardValue>> {
  const facts: Record<string, GuardValue> = {};
  for (const read of plan.reads) {
    for (const field of read.fields) {
      facts[`${read.entity}.${field}`] = asGuardValue(subject.values.get(read.entity)?.[field]);
    }
  }
  return facts;
}

/** ガード式が読める値だけを渡す(読めない形は `null` = 不明)。 */
function asGuardValue(value: SimulatedValue | undefined): GuardValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}
