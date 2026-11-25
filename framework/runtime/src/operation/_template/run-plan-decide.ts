/**
 * 実行計画（`run-plan.ts`）の**`permit` を立てる**部分（4 形ぶん）。
 *
 * 仕様: docs/rules/process/backend/system/standards/conventions/server-actions.md（5 形の定型）
 *       docs/specs/domain/roles.md（グローバルロール・binding・claim）
 *
 * 5 形の定型（`./transition.ts` 等）が形ごとに 1 関数ずつ持っていた「②照会 → 拒否の写像」を、
 * **計画の `kind` で分岐する 1 か所**に畳んだものである。判断そのもの（どの状態からどのロールが
 * 実行できるか）はエンジンの表が持ち、ここに `if` で可否を決める枝は無い。
 *
 * **判断の中身は `./run-plan-decide-core.ts` にある。** ここに残っているのは 2 つだけで、
 * どちらも「このアプリの事情」である。
 *
 *   1. ロール解決の表（製品が渡す `RuntimeBindings.roleTables`）を芯に渡す
 *   2. エンジンが返した拒否を **ARCH-BE-0013 の 3 分類**（`ActionError`）に写す
 *
 * 芯を分けたのは、**同じ判断を仕様側（ハンドブックの結果表）からも引く**ためである ——
 * そこは 4 題材の仕様に対しても同じ判断を引くので、生成物に縛られた口では呼べない。
 * 写して 2 つ目の判定器を置くと、その写し間違いが新しい穴になる。
 */

import { toActionError, toCreateActionError, toDeleteActionError, toWriteActionError } from '@kaninabe/runtime/action-error';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { ActionError } from '@kaninabe/runtime/result';
import type { ActorRoles } from './actor';
import { rejectedRole } from './actor';
import type { RoleTables } from './actor-roles';
import type { StepRejection } from '@kaninabe/runtime/step-decision';
import type { DecideContext, RawStepDecision } from './run-plan-decide-core';
import { decideStepWith, planActorRolesWith } from './run-plan-decide-core';

export type { ActorClaims, DecideContext, PlanStepOutcome, RawStepDecision } from './run-plan-decide-core';
export { changedFields, decidePlanWith } from './run-plan-decide-core';

/** 1 手順の判断の結果（許可なら積むべき副作用も運ぶ）。 */
export type StepDecision =
  | { readonly allowed: true; readonly writeEffects: readonly string[] }
  | { readonly allowed: false; readonly error: ActionError };

/**
 * 手順 1 つの `permit` を立てる。
 *
 * @param tables - 製品が渡すロール解決の表（`RuntimeBindings.roleTables`）
 * @param plan - 実行計画
 * @param step - その手順
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 許可（積む副作用つき）または拒否
 */
export function decideStep(
  tables: RoleTables,
  plan: RunPlan,
  step: RunStepPlan,
  ctx: DecideContext,
): StepDecision {
  return asStepDecision(decideStepWith(tables, plan, step, ctx), step.op);
}

/**
 * エンジンの拒否を Server Action のエラー 3 分類に写す（写像は `domain/action-error.ts` の 1 か所）。
 *
 * @param decision - 芯が返した判断
 * @param op - 拒否が載せる操作 ID
 * @returns 3 分類に落ちた判断
 */
function asStepDecision(decision: RawStepDecision, op: string): StepDecision {
  if (decision.allowed) return { allowed: true, writeEffects: decision.writeEffects };
  return { allowed: false, error: actionErrorOf(decision.rejection, op, rejectedRole(decision.roles)) };
}

/** 形ごとの写像（`ActionError` に落ちたあとの形は 4 形とも同じ）。 */
function actionErrorOf(rejection: StepRejection, op: string, role: string): ActionError {
  switch (rejection.kind) {
    case 'transition':
      return toActionError(rejection.rejected, op, role);
    case 'create':
      return toCreateActionError(rejection.rejected, op, role);
    case 'delete':
      return toDeleteActionError(rejection.rejected, op, role);
    default:
      return toWriteActionError(rejection.rejected, op, role);
  }
}

/**
 * **RPC に渡すロールの集合**（`p_actor_roles`。束 ⑳-3）。
 *
 * @param tables - 製品が渡すロール解決の表（`RuntimeBindings.roleTables`）
 * @param plan - 実行計画
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 全手順で成立しうるロール（`implies` で閉じている）
 */
export function planActorRoles(tables: RoleTables, plan: RunPlan, ctx: DecideContext): ActorRoles {
  return planActorRolesWith(tables, plan, ctx);
}
