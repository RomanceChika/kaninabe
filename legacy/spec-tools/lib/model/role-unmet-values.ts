/**
 * 行の条件(`claim`)を**満たさない**実行者の行に置く値の導出(ADR-0018)。
 *
 * 満たす値(`role-row-values.ts`)の裏返しである。条件を満たさない実行者(負例)は、世界(RLS・一致の証明・保存点)
 * でも生成ユニットテストでも同じ値で立てる —— 値の選び方が 2 か所にあると、片方だけが「外の値」を変える。
 *
 * - state / enum の条件: 欄の値域のうち値の集合に入らないものの先頭
 * - boolean の条件: 偽
 * - 値の集合が値域を覆い尽くす・欄が見つからない: 外の値が無い(`null`)。V11 がこの形を条件が常に真として落とす
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, RoleDef, SpecModel } from './types.js';
import { claimPartsOf, rowConditionOf } from './role-claim.js';
import { collectMachineStates, finiteValuesOfField } from './field-values.js';
import { rowConditionRoles } from './role-hierarchy.js';

/** 欄 → 条件の外の値。 */
export type OutsideValues = Readonly<Record<string, string | false>>;

/** 集約(エンティティ)の欄を引く(意味の層に依らず、モデルだけを読む)。 */
function fieldOf(domain: SpecModel, entity: string, name: string): FieldDef | null {
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity === entity) return specs.entity.fields.find((candidate) => candidate.name === name) ?? null;
  }
  return null;
}

/**
 * そのロールの条件の外の値。
 *
 * @param domain ドメイン仕様
 * @param role 条件を持つロール(`claim` を持つもの)
 * @returns 欄 → 外の値。外の値が無ければ `null`
 */
export function outsideRowValues(domain: SpecModel, role: RoleDef): OutsideValues | null {
  const parts = claimPartsOf(role);
  if (parts === null) return null;
  if (parts.values === null) return { [parts.field]: false };
  const field = fieldOf(domain, parts.entity, parts.field);
  const domainValues = field === null ? null : finiteValuesOfField(field.type, collectMachineStates(domain));
  const outside = domainValues?.find((value) => !(parts.values ?? []).includes(value));
  return outside === undefined ? null : { [parts.field]: outside };
}

/**
 * そのロールの実行者が**満たしてはならない**行の条件を持つロール(= 満たさない実行者を作る相手)。
 *
 * 既定のログインロールの条件(あれば)と、含意の先の条件を持つロール(E2)。それぞれについて、外の値が置けて、
 * かつそのロール自身の `claim` の欄と衝突しない(= そのロールの根拠は成立したまま)ものだけを返す。
 *
 * @param domain ドメイン仕様
 * @param roleId ロール ID
 * @returns 条件を持つロールの ID(重複なし・宣言順)
 */
export function unmetGateRoleIds(domain: SpecModel, roleId: string): readonly string[] {
  const roles = domain.roles.roles;
  const own = roles.find((role) => role.id === roleId);
  const ownField = own === undefined ? null : (rowConditionOf(own)?.field ?? null);
  const candidates: RoleDef[] = [];
  const login = roles.find((role) => role.kind === 'authenticated_default' && rowConditionOf(role) !== null);
  if (login !== undefined) candidates.push(login);
  for (const gate of rowConditionRoles(roles, roleId)) {
    if (!candidates.some((candidate) => candidate.id === gate.id)) candidates.push(gate);
  }
  return candidates
    .filter((gate) => gate.id === roleId || ownField === null || rowConditionOf(gate)?.field !== ownField)
    .filter((gate) => outsideRowValues(domain, gate) !== null)
    .map((gate) => gate.id);
}

/**
 * そのロールに**実際に課されている**行の条件を持つロールのうち、満たさない実行者を作れるもの。
 *
 * `unmetGateRoleIds` は「世界(RLS・一致の証明・保存点)で満たさない人を立てる相手」で、根拠が条件に依らないロール
 * (含意しない束縛のロールなど)にも既定のログインロールの条件を外した人を立てる(その人は根拠だけで立つことを見る)。
 * ここは**拒否になる**相手だけ —— 既定のログインロール自身と、含意の先に条件を持つロールを含意するロール。
 * 生成ユニットテストの「条件を満たさない実行者は拒否される」場面はこちらだけを使う(条件が課されていない役は、条件の外の
 * 状態でも許されたままで、拒否を期待すると嘘になる)。
 *
 * @param domain ドメイン仕様
 * @param roleId ロール ID
 * @returns 条件を持つロールの ID(宣言順)
 */
export function enforcedUnmetRoleIds(domain: SpecModel, roleId: string): readonly string[] {
  const roles = domain.roles.roles;
  const applied = new Set<string>(rowConditionRoles(roles, roleId).map((gate) => gate.id));
  const own = roles.find((role) => role.id === roleId);
  if (own?.kind === 'authenticated_default' && rowConditionOf(own) !== null) applied.add(roleId);
  return unmetGateRoleIds(domain, roleId).filter((id) => applied.has(id));
}
