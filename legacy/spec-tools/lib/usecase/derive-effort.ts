/**
 * ⑥入力・⑦確認・⑨応答と、全指標のまとめ(`deriveUsecaseMetrics` / `metricValue`)。
 *
 * ①②③⑤の導出と土台(`UsecaseInput`・`actionFor`・`flattenSteps`)は derive.ts にあり、ここは
 * それを読んで数える(向きはここ → derive.ts だけ。derive.ts はここを import しない)。
 * ⑥⑦⑨は画面・手順の形ではなく**操作の属性**(入力欄・確認要否・応答)から数えるので、
 * 利用側は数えたい指標に応じて import 先を選ぶ。
 */

import type { SpecModel } from '../model/types.js';
import { findField } from '../semantics/domain-index.js';
import { groundOperation } from '../semantics/operation-ground.js';
import { deriveOperationAttributes } from '../semantics/operation-attributes.js';
import type { UsecaseBudgetMetric, UsecaseSpec } from '../model/usecase/types.js';
import {
  actionFor,
  deriveConcepts,
  deriveScreens,
  deriveStepCount,
  derivePreconditions,
  flattenSteps,
  type ConceptDerivation,
  type PreconditionDerivation,
  type ScreenDerivation,
  type StepCountResult,
  type UsecaseInput,
} from './derive.js';

// ---------------------------------------------------------------------------
// ⑥入力
// ---------------------------------------------------------------------------

/** 手順 1 つぶんの必須入力数。 */
export interface StepInputCount {
  readonly op: string;
  readonly required: number;
}

/** 入力の導出結果。 */
export interface InputDerivation {
  readonly total: number;
  readonly perStep: readonly StepInputCount[];
}

/** 各手順の必須入力数(entity_spec の `required`)を合計する。 */
export function deriveInputs(usecase: UsecaseSpec, input: UsecaseInput): InputDerivation {
  const perStep = flattenSteps(usecase).map(({ step }) => {
    const action = actionFor(input.actions, step.op);
    if (action === undefined) return { op: step.op, required: 0 };
    const required = action.input.filter(
      (ref) => findField(input.domain, ref.entity, ref.field)?.required === true,
    ).length;
    return { op: step.op, required };
  });
  return { total: perStep.reduce((sum, entry) => sum + entry.required, 0), perStep };
}

// ---------------------------------------------------------------------------
// ⑦確認
// ---------------------------------------------------------------------------

/** 確認の導出結果。 */
export interface ConfirmationDerivation {
  readonly total: number;
  /** 確認が要ると判定した手順の op。 */
  readonly flaggedOps: readonly string[];
}

/**
 * 各手順の確認要否を合計する。
 *
 * 要否は**意味解析の層の導出そのもの**(`deriveOperationAttributes` の `confirmRequired`)で、
 * 画面の生成・ハンドブックの操作の章が読む結果と同じである。カタログ(テーブル仕様・ジョブ・通知)は
 * `input.catalogs` から同じ形で渡すので、連鎖(also_writes)や外へ出る効果も見える。
 */
export function deriveConfirmations(usecase: UsecaseSpec, input: UsecaseInput): ConfirmationDerivation {
  const flaggedOps: string[] = [];
  for (const { step } of flattenSteps(usecase)) {
    const action = actionFor(input.actions, step.op);
    if (deriveOperationAttributes(input.domain, input.catalogs, step.op, action).confirmRequired) flaggedOps.push(step.op);
  }
  return { total: flaggedOps.length, flaggedOps };
}

// ---------------------------------------------------------------------------
// ⑨応答(非同期。予算には含めない参考情報)
// ---------------------------------------------------------------------------

/** 非同期(effects を持つ)手順の op(宣言順)。 */
export function deriveAsyncOps(usecase: UsecaseSpec, domain: SpecModel): readonly string[] {
  const ops: string[] = [];
  for (const { step } of flattenSteps(usecase)) {
    const grounding = groundOperation(domain, step.op);
    if (grounding.kind !== 'transition') continue;
    const hasEffect = grounding.entry.machine.effects.some((effect) => effect.on === grounding.entry.event.id);
    if (hasEffect) ops.push(step.op);
  }
  return ops;
}

// ---------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------

/** Y5・ハンドブックが使う、1 ユースケース分の全指標。 */
export interface UsecaseMetrics {
  readonly steps: StepCountResult;
  readonly screens: ScreenDerivation;
  readonly concepts: ConceptDerivation;
  readonly preconditions: PreconditionDerivation;
  readonly inputs: InputDerivation;
  readonly confirmations: ConfirmationDerivation;
  readonly asyncOps: readonly string[];
}

/** 1 ユースケース分の全指標をまとめて導出する。 */
export function deriveUsecaseMetrics(usecase: UsecaseSpec, input: UsecaseInput): UsecaseMetrics {
  return {
    steps: deriveStepCount(usecase),
    screens: deriveScreens(usecase, input),
    concepts: deriveConcepts(usecase, input.domain),
    preconditions: derivePreconditions(usecase, input),
    inputs: deriveInputs(usecase, input),
    confirmations: deriveConfirmations(usecase, input),
    asyncOps: deriveAsyncOps(usecase, input.domain),
  };
}

/** UsecaseMetrics から Y5 が比較する数値だけを取り出す。 */
export function metricValue(metrics: UsecaseMetrics, metric: UsecaseBudgetMetric): number {
  switch (metric) {
    case 'steps':
      return metrics.steps.base;
    case 'screens':
      return metrics.screens.screenIds.length;
    case 'concepts':
      return metrics.concepts.count;
    case 'preconditions':
      return metrics.preconditions.count;
    case 'inputs':
      return metrics.inputs.total;
    case 'confirmations':
      return metrics.confirmations.total;
  }
}
