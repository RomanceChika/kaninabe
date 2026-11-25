/**
 * `permit` を立てる判断の**芯**（`./run-plan-decide.ts` の中身。束 ⑳-5b-b）。
 *
 * 仕様: docs/rules/process/backend/system/standards/conventions/server-actions.md（5 形の定型）
 *       docs/specs/domain/roles.md（グローバルロール・binding・claim）
 *
 * `./run-plan-decide.ts` との違いは 2 つだけである。
 *
 *   1. **ロールの表を引数に取る**（生成物 `GLOBAL_ROLES` / `ROLE_IMPLICATIONS` を読まない）
 *   2. **拒否をエンジンが返した姿のまま返す**（`ActionError` への写像は呼び側が持つ）
 *
 * どちらも「**この判断を仕様側からも引く**」ための形である —— ハンドブックの結果表
 * （`legacy/spec-tools/lib/results/`）は 4 題材の仕様に対しても同じ判断を引き、拒否の凡例には
 * エンジンの診断（許されるロール・成立しなかったガード式・`otherwise_forbidden`）が要る。
 * ここを写して 2 つ目の判定器を置くと、その写し間違いが新しい穴になるだけである
 * （`@kaninabe/runtime/testing/save/oracle`「第 3 の判定器は置かない」と同じ理由）。
 *
 * したがってこのファイルが import してよいのは**相対で届く純関数と型だけ**である
 * （`@/` の別名も、`server-only` も、境界の型も持たない）。判断そのもの（どの状態から
 * どのロールが実行できるか）はエンジンの表が持ち、ここに `if` で可否を決める枝は無い ——
 * 形ごとの照会（4 形の分岐）も `domain/step-decision.ts` の 1 本であり、ここが決めるのは
 * 「その手順ではどのロールが立ち、どの値がガードに入り、どの欄を動かすか」だけである。
 *
 * 編集（`update`）だけ照会が**変更される欄ごと**に走る。数えるものが形によって違う
 * （対象か欄か）のは 5 形の定型と同じ理由である（server-actions.md）。
 */

import type { GuardEnv, GuardValue } from '@kaninabe/runtime/engine';
import type { RunClaimFact, RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { SessionClaims } from '../../domain/bindings';
import type { ShapeDecision, StepRejection } from '@kaninabe/runtime/step-decision';
import { decideShape, rowConditionHolds } from '@kaninabe/runtime/step-decision';
import type { ActorRoles, RoleTables } from './actor-roles';
import { resolveActorRolesWith } from './actor-roles';
import type { PlanInputMap, Resolution } from './run-plan-facts';
import { factValue, stepInput } from './run-plan-facts';

/**
 * 実行者自身の行のうち**セッションに載っている欄**（role_spec の `claim` の根拠）。
 *
 * 載る欄の閉世界は生成物（`SessionClaims` / `SESSION_FIELDS`）が持ち、値を書くのはサインインと
 * `refresh_session_profile` ジョブである（auth-spec-writing.md §session 属性）。この定型が見るのは
 * **計画が名指しした 1 欄が条件を満たすか**（boolean の欄は真・state / enum の欄は値の集合のどれか。
 * ADR-0018）だけであり、欄の名前も値も文字列で持たない。写しは遅れうるので、取り消しの直後は
 * 甘い側に外れうる —— DB の述語が実行者の行を直に読んで必ず落とす（ADR-0012）。
 * 未ログイン（またはプロフィールが無い）は `null`。
 */
export type ActorClaims = SessionClaims | null;

/**
 * `permit` を立てるのに要る、判断のときに渡すもの。
 *
 * セッションに載る欄は `resolution.session` が運ぶ（`claim` のロールもガード式の `actor.{欄}` も
 * 同じ 1 つの事実から立つ。入口を 2 つに割ると、片方だけが直る事故が起きる）。
 */
export interface DecideContext {
  readonly resolution: Resolution;
  /** システム起点の呼び出しか(`roles.md` の `kind: system`)。 */
  readonly system: boolean;
}

/**
 * 1 手順の判断の結果。
 *
 * 拒否のときだけ**立ったロール**を運ぶ —— 拒否が載せるロール（`rejectedRole`）がそこを読む。
 */
export type RawStepDecision =
  | { readonly allowed: true; readonly writeEffects: readonly string[] }
  | { readonly allowed: false; readonly roles: ActorRoles; readonly rejection: StepRejection };

/**
 * 手順 1 つの `permit` を立てる。
 *
 * @param tables - ロール解決が読む表
 * @param plan - 実行計画
 * @param step - その手順
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 許可（積む副作用つき）または拒否（エンジンの診断つき）
 */
export function decideStepWith(
  tables: RoleTables,
  plan: RunPlan,
  step: RunStepPlan,
  ctx: DecideContext,
): RawStepDecision {
  const roles = rolesOfWith(tables, plan, step, ctx);
  const env = envOf(plan, step, ctx.resolution);
  const decision = shapeOfStep(plan, step, ctx, roles, env);
  if (decision.allowed) return decision;
  return { allowed: false, roles, rejection: decision.rejection };
}

/** 形ごとの照会に渡す 3 つ（遷移元の状態・動かす欄）を計画から決める。 */
function shapeOfStep(
  plan: RunPlan,
  step: RunStepPlan,
  ctx: DecideContext,
  roles: ActorRoles,
  env: GuardEnv,
): ShapeDecision {
  if (step.kind === 'update') return decideUpdate(plan, step, ctx, roles, env);
  const stateFrom = step.stateFrom;
  const state = stateFrom === null ? '' : String(factValue(plan, stateFrom, ctx.resolution) ?? '');
  return decideShape(step, { roles, env, state, field: null });
}
// #endregion

/**
 * 編集（`canWrite`）。**変更される欄ごとに**照会し、1 つでも許されなければ全体を拒否する。
 *
 * 許可を返した規則が宣言していた副作用だけを、変更された欄の並び順で重複なく集める
 * （積む・積まないの最終判定は RPC 側にある。domain-spec-writing.md §access_spec）。
 */
// #region example:operation-decide-update
function decideUpdate(
  plan: RunPlan,
  step: RunStepPlan,
  ctx: DecideContext,
  roles: ActorRoles,
  env: GuardEnv,
): ShapeDecision {
  const effects: string[] = [];
  for (const field of changedFields(plan, step, ctx.resolution.input)) {
    const decision = decideShape(step, { roles, env, state: '', field });
    if (!decision.allowed) return decision;
    for (const id of decision.writeEffects) {
      if (!effects.includes(id)) effects.push(id);
    }
  }
  return { allowed: true, writeEffects: effects };
}
// #endregion

/** 手順 1 つと、その手順に立った `permit`。 */
export interface PlanStepOutcome {
  readonly index: number;
  readonly step: RunStepPlan;
  readonly decision: RawStepDecision;
}

/**
 * 手順の順に `permit` を立て、**最初に落ちた手順で止める**（実行器 `run-plan.ts` の契約）。
 *
 * 実行器はここに書き込みを挟むが、判断の並びはこの 1 本と同じである —— 期待の側
 * （一致の証明・結果表）はどちらも書き込みをしないので、並びだけを共有する。
 *
 * @param tables - ロール解決が読む表
 * @param plan - 実行計画
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 判定に届いた手順の結末（最後の 1 つだけが拒否でありうる）
 */
export function decidePlanWith(tables: RoleTables, plan: RunPlan, ctx: DecideContext): readonly PlanStepOutcome[] {
  const outcomes: PlanStepOutcome[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const decision = decideStepWith(tables, plan, step, ctx);
    outcomes.push({ index, step, decision });
    if (!decision.allowed) break;
  }
  return outcomes;
}

/**
 * その編集で実際に変わる欄（送られた鍵だけ。`undefined` は「変更しない」）。
 *
 * 対象の識別子（`id`）は変更集合に入らない —— 絞り込みの条件であって書き換える値ではない。
 * 「1 つも無い」は境界の zod が既に弾いているが、そこを通らない経路が増えても空の更新が
 * DB に届かないよう、呼び側（`run-plan.ts`）が二段目として数え直す。
 *
 * @param plan - 実行計画
 * @param step - その手順
 * @param input - 計画への入力
 * @returns 実際に変わる欄（宣言順）
 */
export function changedFields(plan: RunPlan, step: RunStepPlan, input: PlanInputMap): readonly string[] {
  const row = stepInput(plan, input, Math.max(plan.steps.indexOf(step), 0));
  if (row === null) return [];
  return step.inputKeys.filter((key) => key !== 'id' && row[key] !== undefined);
}

/**
 * **RPC に渡すロールの集合**（`p_actor_roles`。束 ⑳-3）。
 *
 * 手順ごとの解決（`rolesOfWith`）の**和**を取る。手順によって違うのは binding のロールだけだが、
 * その binding のロールが `implies` で素のグローバルロールを含意していると、和を取らなければ
 * **DB だけが落とす** —— DB は配列を「束縛でないロール」の照合にしか使わないので、束縛の
 * ロール自体が余分に入っていても判定は変わらない（少ないほうだけが危険である）。
 *
 * 先頭は「実行者がそもそも何であったか」（`resolveActorRolesWith` が常に先頭に置くグローバル
 * ロール）のまま保つ —— 拒否に載せるロール（`rejectedRole`）がそこを読む。
 *
 * @param tables - ロール解決が読む表
 * @param plan - 実行計画
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 全手順で成立しうるロール（`implies` で閉じている）
 */
export function planActorRolesWith(tables: RoleTables, plan: RunPlan, ctx: DecideContext): ActorRoles {
  const fallback = resolveActorRolesWith(tables, ctx.resolution.actorId, ctx.resolution.session, {}, ctx.system);
  const union = new Set<string>(fallback);
  let head = fallback[0];
  for (const step of plan.steps) {
    const resolved = rolesOfWith(tables, plan, step, ctx);
    head = resolved[0];
    for (const role of resolved) union.add(role);
  }
  return [head, ...[...union].filter((role) => role !== head)];
}

/**
 * その手順で成立するロール（グローバルロール + binding の突合 + claim）。
 *
 * @param tables - ロール解決が読む表
 * @param plan - 実行計画
 * @param step - その手順
 * @param ctx - 読んだ事実・入力・実行者・セッションの欄
 * @returns 成立したロール
 */
export function rolesOfWith(
  tables: RoleTables,
  plan: RunPlan,
  step: RunStepPlan,
  ctx: DecideContext,
): ActorRoles {
  const bindings: Record<string, string | null> = {};
  for (const fact of step.roleFacts) {
    const value = factValue(plan, fact.source, ctx.resolution);
    bindings[fact.role] = typeof value === 'string' ? value : null;
  }
  // `claim` のロールは「実行者自身の行の欄が条件を満たすか」（boolean の欄は真・state / enum の欄は
  // 値の集合のどれか）で立つ。binding と同じ突合に乗せるため、立つときだけ実行者 ID を相手にして
  // 渡す（立たなければ null）。含意の先の条件（E2）は `resolveActorRolesWith` が表（`gates`）で課す。
  for (const claim of step.claimFacts) {
    bindings[claim.role] = claimHolds(ctx.resolution.session, claim) ? ctx.resolution.actorId : null;
  }
  return resolveActorRolesWith(tables, ctx.resolution.actorId, ctx.resolution.session, bindings, ctx.system);
}

/** セッションの写しがその条件を満たすか（写しが無い・欄が無いは満たさない）。 */
function claimHolds(claims: ActorClaims, claim: RunClaimFact): boolean {
  return claims !== null && rowConditionHolds(claim, claims);
}

/**
 * その手順のガード式が参照する変数の割り当て。
 *
 * @param plan - 実行計画
 * @param step - その手順
 * @param resolution - 読んだ事実・入力・実行者・セッションの欄
 * @returns 変数 → 値
 */
export function envOf(plan: RunPlan, step: RunStepPlan, resolution: Resolution): GuardEnv {
  const env: Record<string, GuardValue> = {};
  for (const fact of step.guardFacts) env[fact.variable] = factValue(plan, fact.source, resolution);
  return env;
}
