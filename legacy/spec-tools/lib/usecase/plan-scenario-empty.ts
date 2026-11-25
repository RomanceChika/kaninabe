/**
 * plan-scenario.ts が使う、**変更を 1 つも運ばない編集**の場面。
 *
 * 編集の形だけに現れる意味クラス(`invalid_input`)であり、`permit` の手前で失敗するので RPC は
 * 実行されない(したがって引数の期待も持たない)。
 */

import type { PlanScenario, ScenarioInput, Solved } from './plan-scenario.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import { actorIdFor, claimProfile } from './plan-scenario-actors.js';
import { materialize } from './plan-scenario-materialize.js';
import { SCENARIO_TITLES } from '../messages/messages.js';

/**
 * 変更を 1 つも運ばない編集は入力の不正になる。
 *
 * @param input 計画・ドメイン仕様・A7 の要求
 * @param ctx 場面の materials
 * @param role 実行するロール
 * @param solved ガードを満たす割当
 * @returns 場面 1 つ
 */
export function emptyChangesScenario(
  input: ScenarioInput,
  ctx: ScenarioContext,
  role: string,
  solved: Solved,
): Omit<PlanScenario, 'index'> {
  const actorId = actorIdFor(input, role);
  return {
    covers: ['other'],
    byRole: null,
    title: SCENARIO_TITLES.emptyChange(ctx.label),
    specIds: [ctx.op],
    actorId,
    claims: { ...claimProfile(input, ctx, role), ...solved.claims },
    ...materialize(ctx, { env: solved.env, boundRoles: [role], actorId, changeField: null }),
    outcome: 'saved',
    expect: { kind: 'invalid_input' },
    calls: false,
    args: {},
  };
}
