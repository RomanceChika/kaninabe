/**
 * そのロールを持つ実行者の行が満たす値(行の条件 `claim` を全部満たす値)の導出。
 *
 * ロールの根拠が「実行者自身の行の欄」(boolean の欄が真 / state・enum の欄が値の集合のどれか。ADR-0018)の
 * とき、そのロールを持つ実行者を**作る**側(world・生成テストのセッション)は、欄にどの値を置けばよいかを
 * 決めなければならない。決めるのは次の 1 本だけである(同じ導出を 2 度書かない)。
 *
 * 満たすべき条件は、**自分の `claim` → 含意の先の条件(E2)→ 既定のログインロールの条件**の順で重ねる
 * (ログインした実行者は、行があるだけでは既定のロールを持てない)。同じ欄に値の集合が重なれば共通部分の先頭、
 * 共通部分が空なら先に来た条件を優先する。boolean の欄は真、state / enum の欄は値の集合の先頭を選ぶ。
 * **state / enum の欄に `true` は置かない** —— 列の型に合わず、置けたとしても条件を満たさない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { RoleDef } from './types.js';
import type { RowCondition } from './role-claim.js';
import { rowConditionOf } from './role-claim.js';
import { loginCondition, rowConditionRoles } from './role-hierarchy.js';

/** 欄 → 置く値(boolean の欄は `true`)。 */
export type RowChoice = Readonly<Record<string, string | true>>;

/**
 * そのロールを持つ実行者の行が満たすべき条件(優先順)。
 *
 * @param roles 全ロール宣言
 * @param roleId ロール ID
 * @returns 条件(重複を含みうる。無ければ空)
 */
export function conditionsFor(roles: readonly RoleDef[], roleId: string): readonly RowCondition[] {
  const own = roles.find((role) => role.id === roleId);
  const found: RowCondition[] = [];
  const add = (condition: RowCondition | null): void => {
    if (condition !== null) found.push(condition);
  };
  add(own === undefined ? null : rowConditionOf(own));
  for (const gate of rowConditionRoles(roles, roleId)) add(rowConditionOf(gate));
  add(loginCondition(roles));
  return found;
}

/**
 * そのロールを持つ実行者の行に置く値(条件を全部満たす値)。
 *
 * @param roles 全ロール宣言
 * @param roleId ロール ID
 * @returns 欄 → 値(条件が無ければ空)
 */
export function holdingRowValues(roles: readonly RoleDef[], roleId: string): RowChoice {
  const chosen = new Map<string, readonly string[] | true>();
  for (const condition of conditionsFor(roles, roleId)) {
    const earlier = chosen.get(condition.field);
    if (earlier === undefined) {
      chosen.set(condition.field, condition.values ?? true);
    } else if (earlier !== true && condition.values !== undefined) {
      const common = earlier.filter((value) => condition.values?.includes(value) === true);
      if (common.length > 0) chosen.set(condition.field, common);
    }
  }
  const values: Record<string, string | true> = {};
  for (const [field, choice] of chosen) values[field] = choice === true ? true : (choice[0] ?? '');
  return values;
}
