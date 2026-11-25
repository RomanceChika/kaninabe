/**
 * RLS のオラクルが使う、**ロールの行の条件(`claim`)と `implies` の閉包**の葉。
 *
 * `oracle.mts` から読まれる。条件は実行者のセッションの写し(`BuiltRlsActor.claims`)で評価する ——
 * boolean の欄は真・state / enum の欄は値の集合のどれか(ADR-0018)。アプリの語彙は 1 語も持たない。
 */

import type { RlsWorldRole } from './types.mjs';

/**
 * ロールの行の条件(`claim`)が、実行者のセッションの写しで成り立つか。
 *
 * boolean の欄は真のとき、state / enum の欄は値の集合のどれかのとき。欄が無い・型が合わないは成り立たない
 * (DB の述語が NULL の欄で偽になるのと同じ向き)。条件を持たないロールは成り立つ。
 */
export function conditionHolds(role: RlsWorldRole, claims: Readonly<Record<string, unknown>>): boolean {
  if (role.claimField === null) return true;
  const value = claims[role.claimField];
  if (role.claimValues === undefined) return value === true;
  return typeof value === 'string' && role.claimValues.includes(value);
}

/**
 * 立っているロールのうち、**含意の先の行の条件を満たすものだけ**を残す(E2。ADR-0018)。
 *
 * ロール R の述語は「自分の根拠 AND R が(推移的に)含意するロールの行の条件」である —— 退会した
 * 主催者が今も自分の対象を読めてしまう形を塞ぐ。含意の先に条件を持つロールが無ければ何も落とさない。
 * 先に落としてから `implies` で閉じるので、落としたロールの含意の先は付かない。
 */
export function gated(
  held: ReadonlySet<string>,
  roles: readonly RlsWorldRole[],
  claims: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const byId = new Map<string, RlsWorldRole>(roles.map((role) => [role.id, role]));
  const kept = new Set<string>();
  for (const id of held) {
    const unmet = [...closure(new Set([id]), roles)].some((implied) => {
      const role = byId.get(implied);
      return implied !== id && role !== undefined && !conditionHolds(role, claims);
    });
    if (!unmet) kept.add(id);
  }
  return kept;
}

/** 立っているロールを `implies`(持てば必ず持つ)で閉じる。 */
export function closure(held: ReadonlySet<string>, roles: readonly RlsWorldRole[]): ReadonlySet<string> {
  const found = new Set(held);
  const byId = new Map<string, RlsWorldRole>(roles.map((role) => [role.id, role]));
  const queue = [...held];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const next of byId.get(current)?.implies ?? []) {
      if (found.has(next)) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return found;
}
