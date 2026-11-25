/**
 * plan-scenario.ts が使う、**行の条件(`claim`)を満たさない実行者**の場面(ADR-0018)。
 *
 * 根拠(束縛・`claim`)は成立しているのに、既定のログインロールの条件(実行者の行の状態が集合の外)・
 * 含意の先の条件だけを満たさない実行者は、`permit` の段で拒否される。**この場面が無いと、全部の場面が
 * 「条件を満たす実行者」で書かれ、条件を落としても生成ユニットテストは緑のままになる。**
 * 条件を宣言していない製品、未ログインのロールが実行できる操作、外の値を置けない条件、**実行するロールに条件が課されていない**
 * 場合(含意しない束縛のロールなど。条件の外の状態でも許されたまま)では場面を作らない(宣言しなければ生成物は変わらない)。
 */

import type { PlanScenario, ScenarioInput, Solved } from './plan-scenario.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import { actorIdFor, claimProfile } from './plan-scenario-actors.js';
import { materialize } from './plan-scenario-materialize.js';
import { anonymousRoleId } from '../model/role-hierarchy.js';
import { enforcedUnmetRoleIds, outsideRowValues } from '../model/role-unmet-values.js';
import { SCENARIO_TITLES } from '../messages/messages.js';

/**
 * 条件を満たさない実行者の拒否の場面。
 *
 * @param input 計画・ドメイン仕様
 * @param ctx 場面の materials
 * @param role 実行するロール(根拠は成立させたまま、条件だけを外す)
 * @param solved ガードを満たす割当
 * @returns 場面。作れない(条件が無い・未ログインのロールで通る・外の値が無い)なら null
 */
export function unmetConditionScenario(
  input: ScenarioInput,
  ctx: ScenarioContext,
  role: string,
  solved: Solved,
): Omit<PlanScenario, 'index'> | null {
  const roles = input.domain.roles.roles;
  const anonymous = anonymousRoleId(roles);
  const actorId = actorIdFor(input, role);
  const gate = roles.find((candidate) => candidate.id === enforcedUnmetRoleIds(input.domain, role)[0]);
  if (anonymous === undefined || actorId === null || gate === undefined || ctx.allowedRoles.includes(anonymous)) {
    return null;
  }
  const outside = outsideRowValues(input.domain, gate);
  if (outside === null) return null;
  return {
    covers: ['forbidden'],
    byRole: null,
    title: SCENARIO_TITLES.unmetCondition(ctx.label),
    specIds: [ctx.op],
    actorId,
    claims: { ...claimProfile(input, ctx, role), ...solved.claims, ...outside },
    ...materialize(ctx, { env: solved.env, boundRoles: [role], actorId, changeField: solved.changeField }),
    outcome: 'saved',
    // 条件を満たさない実行者は既定のログインロールを持たず、未ログインと同じロールとして拒否される。
    expect: { kind: 'forbidden', role: anonymous },
    calls: false,
    args: {},
  };
}
