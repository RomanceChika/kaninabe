/**
 * 一致の証明の**他のテナントの行の組み合わせ**(A3-1・A3-2(c))。
 *
 * engine ⇔ RPC の一致だけでは、テナント境界の項を**書き忘れた**仕様を捕まえられない —— engine と RPC が仲良く許可する。
 * そこで境界を結んだ操作では、行を持つ実行者ごとに**他の系統の対象の行**(world の系統は実行者ごとに別のテナントの根を持つ)
 * でも同じ軸を掛け、実行する側(`@kaninabe/runtime/testing/equivalence/expect`)が「engine も RPC も拒否する」を表明する。
 * 作成では、他の系統の行が入力の参照の欄(親)に載るので、「他社の親を指す行を作れない」を実 DB で確かめることになる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from '../guard/ast.js';
import { parseGuard } from '../guard/parser.js';
import type { ScenarioContext } from '../usecase/plan-scenario-rows.js';
import type { EqWorld } from './eq-world-types.js';
import type { EqEnforcement } from './eq-cases.js';

/**
 * その操作が**テナント境界を結んでいるか**(他の系統の行でも実行して拒否を表明してよいか)。
 *
 * 遷移はガード、作成・編集・削除は**その形の規則の全部**の `when` が、トップレベルの `and` の項に `{パス} == actor.{欄}`
 * (`id` 以外)を持つときだけ真。1 本でも結ばない規則があれば、その規則で他の系統の行に届くのは仕様どおりかもしれないので
 * 表明しない(届くかどうかは V26 が仕様の側で見る)。RPC が判定しない操作(`none`)も外す。
 */
export function crossTenantOf(world: EqWorld, ctx: ScenarioContext, enforcement: EqEnforcement): boolean {
  if (enforcement === 'none') return false;
  const sources =
    ctx.kind === 'transition' ? [ctx.guardSource] : ctx.rules.filter((rule) => ctx.allowedRoles.includes(rule.by)).map((rule) => rule.when ?? null);
  if (sources.length === 0) return false;
  if (!sources.every((source) => source !== null && bindsActorAttribute(source))) return false;
  return new Set(world.actors.flatMap((actor) => (actor.target === null ? [] : [actor.target]))).size >= 2;
}

/** 式のトップレベルの `and` の項に `{パス} == actor.{欄}`(`id` 以外。どちらの辺でもよい)があるか。 */
function bindsActorAttribute(source: string): boolean {
  const parsed = parseGuard(source);
  if (!parsed.ok) return false;
  const stack: GuardExpr[] = [parsed.expr];
  for (let expr = stack.pop(); expr !== undefined; expr = stack.pop()) {
    if (expr.kind === 'and') {
      stack.push(expr.left, expr.right);
      continue;
    }
    if (expr.kind !== 'compare' || expr.op !== '==' || expr.rhs.kind !== 'path') continue;
    const sides = [expr.path.segments, expr.rhs.path.segments];
    const actorSide = sides.find((segments) => segments[0] === 'actor' && segments.length === 2 && segments[1] !== 'id');
    const otherSide = sides.find((segments) => segments[0] !== 'actor');
    if (actorSide !== undefined && otherSide !== undefined) return true;
  }
  return false;
}

/**
 * 他の系統の行で実行する実行者(行を持ち、自分と違う系統が world にある人)。
 *
 * 実行する側(`@kaninabe/runtime/testing/equivalence/expect` の `foreignBranch`)と同じ規則でなければならない —— 件数がずれる。
 */
export function crossActorsOf(world: EqWorld, actors: readonly string[]): readonly string[] {
  return actors.filter((key) => {
    const actor = world.actors.find((candidate) => candidate.key === key);
    if (actor === undefined || actor.target === null) return false;
    return world.actors.some((candidate) => candidate.target !== null && candidate.target !== actor.target);
  });
}
