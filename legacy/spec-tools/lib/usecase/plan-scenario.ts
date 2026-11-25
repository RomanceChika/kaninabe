/**
 * 実行計画 1 本 → **生成テストの場面**(束 ⑰-3 / 設計 §6)。
 *
 * A7 が仕様から導く意味クラス(成功 / ガード不成立 / 遷移元でない / 権限なし / 不変条件違反 /
 * 競合 / 対象なし)のそれぞれについて、「読む行にどんな値が載っていて・誰が実行して・RPC が何を
 * 返したら・どう終わるか」を**仕様だけから**決める。決まった場面は
 * `generate/render/code-operation-tests.ts` がユニットテストの字面にする。
 *
 * ## なぜ場面を仕様から作るのか
 *
 * 手書きのユニットテストは、同じことを人が読んで人が書いていた(56 ファイル・約 450 ケース)。
 * 操作が増えるたびに書き写しが増え、書き漏らしは A7 が指摘するまで見えない。実行計画が
 * 「何を読み・どのロールをどう解決し・どのガードを見るか」を仕様から決められる以上、
 * **その宣言を満たす値**も仕様から決められる —— それがここである。
 *
 * ファイル I/O はしない純関数(scripts-code-quality.md)。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { CoverageClass } from '../testcase/types.js';
import type { BuiltOperation } from './operation-plan.js';
import type { ScenarioValue } from './plan-scenario-values.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import type { Materialized } from './plan-scenario-materialize.js';
import { DENIED_ID, contextOf } from './plan-scenario-rows.js';
import { solve } from './plan-scenario-solve.js';
export { solve, type Solved } from './plan-scenario-solve.js';
import type { RejectionClass } from './plan-scenario-actors.js';
import {
  TITLES,
  actorIdFor,
  canHold,
  claimProfile,
  deniedActorIsAnonymous,
  globalRoleOf,
  pickRole,
  withAbsentTarget,
} from './plan-scenario-actors.js';
import { materialize } from './plan-scenario-materialize.js';
import { emptyChangesScenario } from './plan-scenario-empty.js';
import { unmetConditionScenario } from './plan-scenario-unmet.js';
import type { ArgExpect } from './plan-scenario-args.js';
import { expectedArgs } from './plan-scenario-args.js';
import { SCENARIO_TITLES } from '../messages/messages.js';

export type { ScenarioRow, ScenarioContext } from './plan-scenario-rows.js';
export { ACTOR_ID, DENIED_ID, OTHER_ID, TARGET_ID } from './plan-scenario-rows.js';
export { SCENARIO_NOW } from './plan-scenario-values.js';

/** その場面で RPC が返す結末(fake が返す 3 つ)。 */
export type ScenarioOutcome = 'saved' | 'conflict' | 'invariant_violated';

/** その場面の期待(実行器が返すはずの `Result`)。 */
export type ScenarioExpect =
  | { readonly kind: 'ok'; readonly state: string | null; readonly id: string | null }
  | { readonly kind: 'forbidden'; readonly role: string }
  | { readonly kind: 'guard_unsatisfied'; readonly blockedBy: 'state' | 'guard' }
  | { readonly kind: 'invariant_violated'; readonly invariant: string }
  | { readonly kind: 'invalid_input' };

/** 生成テスト 1 本ぶんの場面。 */
export interface PlanScenario {
  /** テストケース ID の連番(action_spec の生成ブロックと `@tc` が共有する)。 */
  readonly index: number;
  readonly covers: readonly CoverageClass[];
  /** 成功のロール(A7 の `by_role`。それ以外は null)。 */
  readonly byRole: string | null;
  /** `it()` の名前(人の言葉。仕様の label とロール ID から組む)。 */
  readonly title: string;
  /** その場面が守る仕様の ID(`spec_ids`)。 */
  readonly specIds: readonly string[];
  readonly actorId: string | null;
  /** 既定の一式の上から置くセッションの欄(`claim` の根拠。真か立つ値。条件を満たさない場面は条件の外の値。ADR-0018)。 */
  readonly claims: Readonly<Record<string, string | boolean>>;
  readonly rows: Materialized['rows'];
  readonly input: Materialized['input'];
  readonly outcome: ScenarioOutcome;
  readonly expect: ScenarioExpect;
  /** RPC を 1 回呼び出すはずか(入力の不正・`permit` の拒否では呼び出さない)。 */
  readonly calls: boolean;
  /**
   * RPC が受け取るはずの**名前つき引数**(呼び出さない場面は空)。
   *
   * 値の出どころは場面そのもの(実行者・行に載せた状態・作った入力)であり、計画から
   * 写すのは引数の名前と供給元の種別だけである。これが無かったあいだ、成功の場面が
   * RPC について確かめていたのは関数名だけで、**配線の取り違えを見る場所が無かった**
   * (独立レビュー 1-B)。突合は部分一致なので、ここに無い引数は見ない。
   */
  readonly args: Readonly<Record<string, ArgExpect>>;
}

/** 場面を組み立てるのに要る入力。 */
export interface ScenarioInput {
  readonly operation: BuiltOperation;
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  /** A7 が要求する意味クラス。 */
  readonly required: readonly CoverageClass[];
  /** A7 が要求する「成功するロール」。 */
  readonly roles: readonly string[];
}

/**
 * 実行計画 1 本ぶんの場面を並べる。
 *
 * @param input 計画・ドメイン仕様・ガード解析・A7 の要求
 * @returns 場面(並び順がテストの並び順であり、テストケース ID の連番でもある)
 */
export function buildPlanScenarios(input: ScenarioInput): readonly PlanScenario[] {
  const ctx = contextOf(input.operation, input.domain, input.guards);
  const drafts: Omit<PlanScenario, 'index'>[] = [];
  for (const role of input.roles) {
    const success = successScenario(input, ctx, role);
    if (success !== null) drafts.push(success);
  }
  for (const cls of ['guard_unsatisfied', 'invalid_from', 'forbidden'] as const) {
    if (!input.required.includes(cls)) continue;
    const scenario = rejectionScenario(input, ctx, cls);
    if (scenario !== null) drafts.push(scenario);
  }
  // 根拠は成立しているが行の条件を満たさない実行者(条件を宣言していなければ作らない)。
  const unmetRole = pickRole(input, ctx);
  const unmetSolved = unmetRole === null ? null : solve(input, ctx, unmetRole, { guard: true, insideFrom: true });
  const unmet = unmetSolved === null ? null : unmetConditionScenario(input, ctx, unmetRole ?? '', unmetSolved);
  if (unmet !== null) drafts.push(unmet);
  // **対象なしは A7 の要求に関わらず置く**(独立レビュー 1-D)。A7 がこれを要求するのは削除だけ
  // なので、遷移・作成・編集ではこの場面が 1 つも生成されていなかった ——「見えない」と
  // 「権限が無い」を区別しないのは権限に直結する設計判断であり、行を読む計画ならゼロ費用で
  // 実行できる。`covers` に足すので A7 の要求は満たしたまま情報だけが増える。
  const absent = rejectionScenario(input, ctx, 'not_found');
  if (absent !== null) drafts.push(absent);
  for (const cls of ['invariant', 'conflict'] as const) {
    if (!input.required.includes(cls)) continue;
    const scenario = outcomeScenario(input, ctx, cls === 'conflict' ? 'conflict' : 'invariant_violated');
    if (scenario !== null) drafts.push(withAbsentTarget(input, ctx, scenario));
  }
  const emptyRole = ctx.kind === 'update' ? pickRole(input, ctx) : null;
  const emptySolved = emptyRole === null ? null : solve(input, ctx, emptyRole, { guard: true, insideFrom: true });
  if (emptyRole !== null && emptySolved !== null) {
    drafts.push(emptyChangesScenario(input, ctx, emptyRole, emptySolved));
  }
  return drafts.map((draft, index) => ({ ...draft, index: index + 1 }));
}

/** そのロールとして成功する場面(A7 の `by_role` の義務に 1 対 1 で対応する)。 */
function successScenario(
  input: ScenarioInput,
  ctx: ScenarioContext,
  role: string,
): Omit<PlanScenario, 'index'> | null {
  const solved = solve(input, ctx, role, { guard: true, insideFrom: true });
  if (solved === null || !canHold(input, ctx, role)) return null;
  const actorId = actorIdFor(input, role);
  const rows = materialize(ctx, { env: solved.env, boundRoles: [role], actorId, changeField: solved.changeField });
  return {
    covers: ['success'],
    byRole: role,
    title: SCENARIO_TITLES.success(role, ctx.label),
    specIds: [ctx.op],
    actorId,
    claims: { ...claimProfile(input, ctx, role), ...solved.claims },
    ...rows,
    outcome: 'saved',
    expect: { kind: 'ok', state: ctx.resultState, id: resultIdOf(ctx, rows.input) },
    calls: true,
    args: expectedArgs(ctx, input.operation.params, { ...rows, actorId }),
  };
}

/** 成功値の id(入力から決まるなら literal、冪等キーなら null)。 */
function resultIdOf(ctx: ScenarioContext, input: Readonly<Record<string, ScenarioValue>>): string | null {
  if (ctx.resultIdField === null) return null;
  const value = input[ctx.resultIdField];
  return typeof value === 'string' ? value : null;
}

/** 拒否の場面(ガード不成立・遷移元でない・権限なし・対象なし)。 */
function rejectionScenario(
  input: ScenarioInput,
  ctx: ScenarioContext,
  cls: RejectionClass,
): Omit<PlanScenario, 'index'> | null {
  const role = pickRole(input, ctx);
  if (role === null) return null;
  const solved = solve(input, ctx, role, {
    guard: cls !== 'guard_unsatisfied',
    insideFrom: cls !== 'invalid_from',
  });
  if (solved === null) return null;
  if (cls === 'not_found' && ctx.reads.length === 0) return null;
  const denied = cls === 'forbidden';
  const actorId = denied ? (deniedActorIsAnonymous(input, ctx) ? null : DENIED_ID) : actorIdFor(input, role);
  return {
    covers: [cls],
    byRole: null,
    title: TITLES[cls](ctx.label),
    specIds: [ctx.op],
    actorId,
    claims: denied ? {} : { ...claimProfile(input, ctx, role), ...solved.claims },
    ...materialize(ctx, {
      env: solved.env,
      boundRoles: denied ? [] : [role],
      actorId,
      changeField: solved.changeField,
      missing: cls === 'not_found',
    }),
    outcome: 'saved',
    expect:
      cls === 'guard_unsatisfied'
        ? { kind: 'guard_unsatisfied', blockedBy: 'guard' }
        : cls === 'invalid_from'
          ? { kind: 'guard_unsatisfied', blockedBy: 'state' }
          : // 「見えない」と「権限が無い」は区別しない(`run-plan.ts`)ので、
            // 対象が無い場面も権限の拒否に写る。
            { kind: 'forbidden', role: globalRoleOf(input, actorId) },
    calls: false,
    args: {},
  };
}

/** RPC の結末だけが違う場面(不変条件違反・競合)。 */
function outcomeScenario(
  input: ScenarioInput,
  ctx: ScenarioContext,
  outcome: Exclude<ScenarioOutcome, 'saved'>,
): Omit<PlanScenario, 'index'> | null {
  const role = pickRole(input, ctx);
  if (role === null) return null;
  const solved = solve(input, ctx, role, { guard: true, insideFrom: true });
  const invariant = ctx.invariant;
  if (solved === null) return null;
  if (outcome === 'invariant_violated' && invariant === null) return null;
  const actorId = actorIdFor(input, role);
  const conflict = outcome === 'conflict';
  const rows = materialize(ctx, { env: solved.env, boundRoles: [role], actorId, changeField: solved.changeField });
  return {
    covers: [conflict ? 'conflict' : 'invariant'],
    byRole: null,
    title: conflict ? SCENARIO_TITLES.conflict(ctx.label) : SCENARIO_TITLES.invariant(ctx.label),
    specIds: [conflict ? ctx.op : (invariant ?? ctx.op)],
    actorId,
    claims: { ...claimProfile(input, ctx, role), ...solved.claims },
    ...rows,
    outcome,
    expect: conflict
      ? { kind: 'guard_unsatisfied', blockedBy: 'state' }
      : { kind: 'invariant_violated', invariant: invariant ?? '' },
    calls: true,
    args: expectedArgs(ctx, input.operation.params, { ...rows, actorId }),
  };
}
