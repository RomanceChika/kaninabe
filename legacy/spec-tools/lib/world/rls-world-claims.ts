/**
 * world の実行者の行に置く、**行の条件(`claim`)を満たす値 / 満たさない値**(ADR-0018)。
 *
 * ロールには「実行者自身の行の欄」が根拠になるものがある —— boolean の欄が真(従来の `claim`)、
 * state / enum の欄が値の集合のどれか(E1)、既定のログインロールに併記した条件。world の実行者は
 * 次の 2 通りに分かれる。
 *
 * - **満たす実行者(positive)**: そのロールを持つ人。欄には**条件を満たす値**を置く。boolean の欄は真、
 *   state / enum の欄は値の集合の先頭(複数のロールの条件が同じ欄に重なるときは共通部分の先頭)。
 *   **state の欄に `true` を置いてはならない** —— DB の列の型に合わず、置けたとしても条件を満たさない。
 * - **満たさない実行者(unmet)**: ロールの根拠(束縛など)は成立しているが、含意の先の行の条件(E2)を
 *   満たさない人。欄には**条件の外の値**(欄の値域のうち集合に入らないもの)を置く。boolean の欄は偽。
 *   集合が値域を覆い尽くす欄には外の値が無いので、この人は作れない(`null`)。
 *
 * 標準の実行者は**既定のログインロールの条件も満たす**。ログインした人は集約に行があるだけでは
 * 既定のロールを持てないので、条件を宣言した製品では、条件を満たす値が world の行の初期値になる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { holdingRowValues } from '../model/role-row-values.js';
import { outsideRowValues, unmetGateRoleIds } from '../model/role-unmet-values.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import type { RlsValue } from './rls-world-values.js';
import { claimImplications } from './rls-world-values.js';

/** 欄 → 置く値。 */
export type RowValues = Readonly<Record<string, RlsValue>>;

/**
 * そのロールを持つ実行者の行に置く値(条件を全部満たす値。導出は `holdingRowValues` の 1 本)。
 *
 * boolean の欄を真にするときは、その欄が真なら満たすべき行内比較(`claimImplications`)の値も一緒に置く。
 *
 * @param domain ドメイン仕様
 * @param roleId ロール ID
 * @returns 欄 → 値(条件が無ければ空)
 */
export function holdingValues(domain: SpecModel, roleId: string): RowValues {
  const entity = actorEntity(domain);
  const values: Record<string, RlsValue> = {};
  for (const [field, choice] of Object.entries(holdingRowValues(domain.roles.roles, roleId))) {
    values[field] = choice;
    if (choice === true && entity !== null) Object.assign(values, claimImplications(domain, entity, field));
  }
  return values;
}

/**
 * そのロールの実行者が**満たしてはならない**行の条件を持つロール(= 満たさない実行者を作る相手)。導出は
 * `unmetGateRoleIds` の 1 本(生成ユニットテストの負例と同じ)から、**DB に入る行にできないもの**を除く。
 *
 * 満たさない実行者の欄に条件の外の値を置くと、そのロールの根拠の欄が真のときに行内比較の不変条件
 * (`claimImplications`)が要求する値とぶつかることがある(「運営スタッフなら有効メンバー」の行に、有効でない値を
 * 置く形)。そのような行は DB の CHECK が入れさせない —— 設計で不可能にした事実であり、世界に立てる負例ではない
 * (ユニットテストの負例は DB を通さないので `unmetGateRoleIds` のまま残る)。
 *
 * @param domain ドメイン仕様
 * @param roleId ロール ID
 * @returns 条件を持つロールの ID(重複なし・宣言順)
 */
export function unmetGateRoles(domain: SpecModel, roleId: string): readonly string[] {
  return unmetGateRoleIds(domain, roleId).filter((gate) => !contradictsImplication(domain, roleId, gate));
}

/** 満たさない実行者の欄の値が、根拠の欄が真のときの行内比較の不変条件とぶつかるか。 */
function contradictsImplication(domain: SpecModel, roleId: string, gateRoleId: string): boolean {
  const entity = actorEntity(domain);
  if (entity === null) return false;
  const values = unmetValues(domain, roleId, gateRoleId);
  return Object.entries(holdingRowValues(domain.roles.roles, roleId)).some(
    ([field, choice]) =>
      choice === true &&
      Object.entries(claimImplications(domain, entity, field)).some(([implied, value]) => values[implied] !== value),
  );
}

/**
 * そのロールの実行者の行に置く値 —— ただし `gate` の条件だけは満たさない(満たさない実行者)。
 *
 * ほかの条件は満たす側のまま置く(`gate` と欄が重なる条件は `gate` の外の値が優先される)。
 *
 * @param domain ドメイン仕様
 * @param roleId 実行者が根拠を持つロール
 * @param gateRoleId 条件を満たさせないロール(`unmetGateRoles` が返したもの)
 * @returns 欄 → 値
 */
export function unmetValues(domain: SpecModel, roleId: string, gateRoleId: string): RowValues {
  const gate = domain.roles.roles.find((role) => role.id === gateRoleId);
  const outside = gate === undefined ? null : outsideRowValues(domain, gate);
  return { ...holdingValues(domain, roleId), ...(outside ?? {}) };
}
