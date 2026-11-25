/**
 * 手順が認めるロールごとの、併せて満たす行の条件(ADR-0018)の導出。
 *
 * `plan-facts.ts` から読まれる葉である。純関数であり throw しない。
 */

import type { SpecModel } from '../model/types.js';
import { groundedConditions } from '../model/role-hierarchy.js';
import type { UsecaseRowCondition, UsecaseStepFacts } from './plan-facts-types.js';

/**
 * 手順が認めるロールごとの、併せて満たす行の条件(無ければ何も足さない —— 宣言しなければ計画は変わらない)。
 *
 * 既定のログインロール自身の条件と、含意の先の条件(E2)。DB の述語と同じ集合を `groundedConditions` が返す。
 */
export function gatesOf(domain: SpecModel, roles: readonly string[]): Pick<UsecaseStepFacts, 'roleGates'> | Record<string, never> {
  const gates: Record<string, readonly UsecaseRowCondition[]> = {};
  for (const role of roles) {
    const conditions = groundedConditions(domain.roles.roles, role);
    if (conditions.length > 0) gates[role] = conditions;
  }
  return Object.keys(gates).length === 0 ? {} : { roleGates: gates };
}
