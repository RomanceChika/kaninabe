/**
 * A7 の必要クラス導出が使う「ドメイン仕様の引き当て」。
 *
 * 導出そのもの(どの操作にどのクラスが要るか)は `required-coverage.ts` にあり、こちらは
 * その材料を仕様モデルから拾う照会だけを持つ。使い手は 2 本 —— 導出の `required-coverage.ts` と、
 * 遷移の「拒否されるロール」だけを引く L2 の網羅表の生成(`generate/render/l2-sweep-transitions.ts`)。
 * 後者は導出の規則表を要らないので、照会は別の部品として置いてある。
 */

import type { SpecModel } from '../model/types.js';
import type { AccessOpEntry } from '../semantics/domain-index.js';
import { isHumanRole } from '../semantics/domain-index.js';
import { touchesFields } from './invariant-fields.js';
import { impliedRoles, systemRoleId } from '../model/role-hierarchy.js';

/**
 * その操作を許されていない人間ロールを列挙する。
 *
 * 「拒否されるロールが存在するか」が forbidden を要求する条件であり、
 * 全人間ロールに許された操作には拒否の反例が作れない。
 *
 * **ロール階層(`implies`)を考慮する。** `allowed` に無いロールでも、そのロールが
 * (推移的に)`allowed` のいずれかを含意していれば「そのロールを持つ主体は必ず許可された
 * ロールでもある」ので、拒否されるロールには数えない(例: `allowed: [member]` のとき、
 * `staff implies member` なら `staff` は拒否されない)。逆に `allowed` 側のロールを
 * implies で下流に広げることはしない — 「member を許す」は「member を必ず持つ全員」を
 * 許すのであって、member が implies するロール固有の権限まで広げる宣言ではないため。
 */
export function deniedHumanRoles(domain: SpecModel, allowed: readonly string[]): string[] {
  const roles = domain.roles.roles;
  const systemRole = systemRoleId(roles);
  return roles
    .map((role) => role.id)
    .filter((id) => isHumanRole(id, systemRole) && !isEffectivelyAllowed(roles, allowed, id));
}

/** そのロール自身が allowed に含まれるか、implies で(推移的に) allowed のいずれかを含意しているか。 */
function isEffectivelyAllowed(
  roles: SpecModel['roles']['roles'],
  allowed: readonly string[],
  id: string,
): boolean {
  if (allowed.includes(id)) return true;
  const implied = impliedRoles(roles, id);
  return allowed.some((role) => implied.has(role));
}

/**
 * 指定エンティティの指定フィールドに触れる、DB 制約・トリガーで執行される不変条件の ID。
 *
 * 裸のフィールド名(`uniqueness` の `keys` など)は、その不変条件を宣言した集約の
 * エンティティのものとして解決する(`invariant-fields.ts`)。
 */
export function invariantsTouching(
  domain: SpecModel,
  entity: string,
  fields: readonly string[],
): string[] {
  const found: string[] = [];
  for (const specs of domain.aggregates.values()) {
    const ownEntity = specs.access?.entity ?? specs.entity?.entity ?? specs.name;
    for (const invariant of specs.invariants?.invariants ?? []) {
      const enforcedInDb = invariant.enforcedBy.some(
        (e) => e.kind === 'db_constraint' || e.kind === 'trigger',
      );
      if (!enforcedInDb) continue;
      if (touchesFields(invariant, ownEntity, entity, fields)) found.push(invariant.id);
    }
  }
  return found;
}

/**
 * `involves` に指定エンティティを挙げている不変条件の ID(モデル全体を横断)。
 *
 * 「別集約を数える不変条件」の義務を、数えられる側(`involves` に挙がった集約)の
 * create / delete / 全遷移に配るための引き当てである(action-spec-writing.md §A7 involves
 * 拡張。domain-spec-writing.md §invariant_spec の `involves`)。`invariantsEnforcedOn` と違い
 * DB 制約・トリガーの有無は問わない — `involves` を書いた時点で「この操作がこの不変条件に
 * 触れうる」という宣言だからである。
 */
export function invariantsInvolving(domain: SpecModel, entity: string): string[] {
  const found: string[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if ((invariant.involves ?? []).includes(entity)) found.push(invariant.id);
    }
  }
  return found;
}

/** 指定イベントを `enforced_by: guard` の ref に持つ不変条件の ID。 */
export function invariantsGuardedBy(domain: SpecModel, eventId: string): string[] {
  return listInvariants(domain)
    .filter((inv) => inv.enforcedBy.some((e) => e.kind === 'guard' && e.ref === eventId))
    .map((inv) => inv.id);
}

/**
 * 指定エンティティに DB 制約・トリガーで効く不変条件の ID(作成用)。
 *
 * 作成は**その行の全フィールドを一度に置く**操作なので、そのエンティティに効く不変条件とは
 * 必ず交わる。編集の交わり判定(`invariantsTouching`)の特殊形であり、フィールドを見るまでも
 * なく「触れる」と言えるためこちらは集約の一覧だけで足りる。
 *
 * 探す先をその集約自身の invariant_spec に限るのは、作成で最初に効く制約はその行のテーブルに
 * 付いているものだからである(相手側のテーブルの制約は、その相手を書き換える操作 —
 * つまり編集 — のときに交わり判定で拾われる)。
 */
export function invariantsEnforcedOn(domain: SpecModel, entry: AccessOpEntry<unknown>): string[] {
  const own = domain.aggregates.get(entry.aggregate)?.invariants?.invariants ?? [];
  return own
    .filter((inv) => inv.entities.includes(entry.entity))
    .filter((inv) => inv.enforcedBy.some((e) => e.kind === 'db_constraint' || e.kind === 'trigger'))
    .map((inv) => inv.id);
}

/** モデル中の全不変条件(集約をまたいで効くものがあるため横断で見る)。 */
function listInvariants(domain: SpecModel) {
  return [...domain.aggregates.values()].flatMap((specs) => specs.invariants?.invariants ?? []);
}
