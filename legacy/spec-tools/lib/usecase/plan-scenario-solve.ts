/**
 * plan-scenario.ts が使う、**ガード式と状態の割当を解く**部分(場面の値を仕様から決める核)。
 *
 * ファイル I/O はしない純関数。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, GuardServices } from '../guard/ast.js';
import type { Assignment, ScenarioValue } from './plan-scenario-values.js';
import { candidatesOf, searchAssignment, seedsOf } from './plan-scenario-values.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import { accessRulesOf, sessionClaimsOf } from './plan-scenario-rows.js';
import { claimProfile } from './plan-scenario-actors.js';
import type { ScenarioInput } from './plan-scenario.js';

/** 解いた割当と、編集で動かす欄。 */
export interface Solved {
  readonly env: Assignment;
  readonly changeField: string | null;
  /** 実行者の属性の変数の値(セッションの欄に置く。`sessionClaimsOf`)。 */
  readonly claims: Readonly<Record<string, string | boolean>>;
}

/**
 * ガード式と状態の割当を解く。
 *
 * 遷移は「状態 × ガード」、作成・削除・編集は「そのロールに効く規則の `when`」を解く。
 * 編集だけは**動かす欄**も一緒に決まる(規則が欄の集合を持つため)。
 */
export function solve(
  input: ScenarioInput,
  ctx: ScenarioContext,
  role: string,
  want: { readonly guard: boolean; readonly insideFrom: boolean },
): Solved | null {
  const rule = ctx.kind === 'transition' ? null : (accessRulesOf(ctx, role)[0] ?? null);
  if (ctx.kind !== 'transition' && rule === null) return null;
  const expr = parse(input.guards, ctx.kind === 'transition' ? ctx.guardSource : (rule?.when ?? null));
  const states = want.insideFrom ? ctx.fromStates : ctx.outsideStates;
  if (ctx.stateVariable !== null && states.length === 0) return null;
  const fixed: Record<string, ScenarioValue> = { ...ctx.nowVariables };
  if (ctx.stateVariable !== null && !ctx.stateVariable.inGuard) fixed[ctx.stateVariable.key] = states[0] ?? '';
  const variables = ctx.variables.map((variable) => ({
    key: variable.key,
    candidates:
      variable.key === ctx.stateVariable?.key
        ? states
        : candidatesOf(variable.type, variable.states, seedsOf(expr), variable.bounds),
  }));
  // 実行者の属性は、そのロールを立てるセッションの欄(`claim` の根拠)と同じ欄なら、その値に固定する(ロールを立てたまま解く)。
  const held: Readonly<Record<string, ScenarioValue>> = claimProfile(input, ctx, role);
  const sessionVariables = ctx.sessionVariables.map((variable) => ({
    key: variable.key,
    candidates:
      variable.field in held
        ? [held[variable.field] ?? null]
        : candidatesOf(variable.type, variable.states, seedsOf(expr), variable.bounds),
  }));
  const env = searchAssignment([...variables, ...sessionVariables], expr, want.guard, fixed);
  if (env === null) return null;
  const changeField = ctx.kind === 'update' ? (rule?.fields[0] ?? null) : null;
  if (ctx.kind === 'update' && changeField === null) return null;
  return { env, changeField, claims: sessionClaimsOf(ctx, env) };
}

/** ガード式をパースする(宣言が無ければ「常に真」= null)。 */
function parse(guards: GuardServices, source: string | null): GuardExpr | null {
  if (source === null) return null;
  const parsed = guards.parse(source);
  return parsed.ok ? parsed.expr : null;
}
