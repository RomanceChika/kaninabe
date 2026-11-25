/**
 * plan-scenario.ts が使う、**拒否の場面を誰として実行するか**(束 ⑰-3)。
 *
 * ロールを立てる手(セッションの属性 / 行の列 / グローバル)と、拒否の場面の実行者の選び方を持つ。
 * 拒否の意味クラス(`RejectionClass`)の宣言もここにあり、場面の作り方が 1 つに決まるそのクラスと、
 * クラスごとに 1 文のテスト名(`TITLES`)は同じ表の両面なので同居する(クラスを足すと名前も要る)。
 */

import type { SpecModel } from '../model/types.js';
import { anonymousRoleId, globalRoleId } from '../model/role-hierarchy.js';
import { holdingRowValues } from '../model/role-row-values.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import { roleClaimOf } from './plan-facts-parts.js';
import { actorEntity } from './param-source-facts.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import { ACTOR_ID, roleHolders } from './plan-scenario-rows.js';
import type { ScenarioValue } from './plan-scenario-values.js';
import { placeholderOf } from './plan-scenario-values.js';
import type { PlanScenario, ScenarioInput } from './plan-scenario.js';
import { SCENARIO_TITLES } from '../messages/messages.js';

/**
 * セッションが運ぶ欄(`entity_spec` の `session: true`)の**既定の一式**。
 *
 * 場面が上書きするのはロールの根拠になる欄だけだが、セッションの型はその 1 つでは
 * 満たされない —— 残りの欄も埋めなければ生成テストがコンパイルできない。何で埋めるかは
 * **型が決める**(`placeholderOf`)。仕組み側のコードにアプリの欄名を書かないための 1 手である
 * (束 ⑰-3 は `display_name` をここに直書きしていた。独立レビュー 6-A)。
 *
 * ただし**既定のログインロールが行の条件(`claim`)を宣言していれば、その条件を満たす値で埋める**
 * (ADR-0018)。ログインした実行者は、行があるだけでは既定のロールを持てない —— 型から決めた値の
 * ままでは、ログインした実行者が全員「条件を満たさない人」になり、生成テストが全部落ちる。
 *
 * @param domain ドメイン仕様
 * @returns 欄名 → 型から決まる既定値(実行者の集約が無ければ空)
 */
export function sessionProfileOf(domain: SpecModel): Readonly<Record<string, ScenarioValue>> {
  const entity = actorEntity(domain);
  if (entity === null) return {};
  const profile: Record<string, ScenarioValue> = {};
  for (const field of findEntitySpec(domain, entity)?.fields ?? []) {
    if (field.session !== true) continue;
    profile[field.name] = placeholderOf(field);
  }
  const login = globalRoleId(domain.roles.roles, 'authenticated_default');
  if (login !== undefined) Object.assign(profile, holdingRowValues(domain.roles.roles, login));
  return profile;
}

/** 拒否の意味クラス(場面の作り方が 1 つに決まるもの)。 */
export type RejectionClass = 'guard_unsatisfied' | 'invalid_from' | 'forbidden' | 'not_found';

/** そのロールを実行器が立てられるか(claim / binding / グローバル)。 */
export function canHold(input: ScenarioInput, ctx: ScenarioContext, role: string): boolean {
  const roles = input.domain.roles.roles;
  if (role === globalRoleId(roles, 'authenticated_default') || role === anonymousRoleId(roles)) return true;
  if (roleClaimOf(input.domain, role) !== null) return ctx.claimFields.length > 0;
  return roleHolders(ctx).has(role);
}

/**
 * 「この操作を実行できるロール」のうち、実行器が立てられるものを 1 つ選ぶ(拒否の場面の主役)。
 *
 * 性質の側(`plan-scenario-property.ts`)も同じ選び方を使う。
 */
export function pickRole(input: ScenarioInput, ctx: ScenarioContext): string | null {
  return input.roles.find((role) => canHold(input, ctx, role)) ?? null;
}

/** ログイン済みなら誰でも実行できる操作では、拒否される実行者は未ログインである。 */
export function deniedActorIsAnonymous(input: ScenarioInput, ctx: ScenarioContext): boolean {
  const member = globalRoleId(input.domain.roles.roles, 'authenticated_default');
  return member !== undefined && ctx.allowedRoles.includes(member);
}

/** 実行者に必ず 1 つ成立するグローバルロール(ロール ID は仕様から引く。W1)。 */
export function globalRoleOf(input: ScenarioInput, actorId: string | null): string {
  const roles = input.domain.roles.roles;
  const id = actorId === null ? anonymousRoleId(roles) : globalRoleId(roles, 'authenticated_default');
  return id ?? '';
}

/** 拒否の場面のテスト名(クラスごとに 1 文)。 */
export const TITLES: Readonly<Record<RejectionClass, (label: string) => string>> = {
  guard_unsatisfied: SCENARIO_TITLES.guardUnsatisfied,
  invalid_from: SCENARIO_TITLES.invalidFrom,
  forbidden: SCENARIO_TITLES.forbidden,
  not_found: SCENARIO_TITLES.notFound,
};

/** そのロールとして実行する実行者の id(未ログインのロールだけ null)。 */
export function actorIdFor(input: ScenarioInput, role: string): string | null {
  return role === anonymousRoleId(input.domain.roles.roles) ? null : ACTOR_ID;
}

/**
 * そのロールを持つ実行者のセッションの欄に、既定の一式の上から置く値(`claim` のロールだけ)。
 *
 * boolean の欄は真、state / enum の欄は値の集合の先頭(含意の先の条件・既定のログインロールの条件も満たす値。
 * ADR-0018)。`claim` が根拠でないロールは空(既定の一式のままで、そのロールが立つ)。
 */
export function claimProfile(
  input: ScenarioInput,
  ctx: ScenarioContext,
  role: string,
): Readonly<Record<string, string | true>> {
  const claim = roleClaimOf(input.domain, role);
  if (claim === null || !ctx.claimFields.includes(claim.field)) return {};
  return holdingRowValues(input.domain.roles.roles, role);
}

/**
 * 手順が認める `claim` のロールを**全部持つ**実行者のセッションの欄(性質の実行者。ロールの根拠は列の値として
 * 振るので、実行者そのものは振らない)。同じ欄に別の値が重なれば先に来たロールを優先する。
 */
export function claimsOfAll(input: ScenarioInput, ctx: ScenarioContext): Readonly<Record<string, string | true>> {
  const merged: Record<string, string | true> = {};
  for (const role of ctx.claimRoles) {
    for (const [field, value] of Object.entries(claimProfile(input, ctx, role))) {
      if (!(field in merged)) merged[field] = value;
    }
  }
  return merged;
}

/**
 * **判断材料を 1 行も読まない操作**では、「対象が実在しない」は競合として現れる。
 *
 * 読む行があれば「読めなかった」=`forbidden` の場面を作れるが、読む行が無い操作
 * (誰でも実行できる台帳の削除など)にはその段が無く、対象の不在は定型 RPC が 0 行を返すこと
 * でしか分からない —— それはこの実行器では競合と同じ結末である。したがって競合の場面が
 * `not_found` も兼ねる。**兼ねられないのに宣言だけする**ことはしない(A7 は covers の
 * 和集合を見るので、ここで足さなければ仕様の側で欠落として現れる)。
 */
export function withAbsentTarget(
  input: ScenarioInput,
  ctx: ScenarioContext,
  scenario: Omit<PlanScenario, 'index'>,
): Omit<PlanScenario, 'index'> {
  if (!scenario.covers.includes('conflict')) return scenario;
  if (ctx.reads.length > 0 || !input.required.includes('not_found')) return scenario;
  return {
    ...scenario,
    covers: ['conflict', 'not_found'],
    title: SCENARIO_TITLES.alsoAbsentTarget(scenario.title),
  };
}
