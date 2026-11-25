/**
 * 一致の証明の**実行者の並びと控えの行**(束 ⑳-5a)。
 *
 * `eq-world.ts`(world 全体の組み立て)が呼ぶ下位の部品である。ここが決めるのは 2 つ ——
 * 誰を何人置くかと、その人が渡すロール配列である。型と定数は葉の `eq-world-types.ts` から読み、
 * `eq-world.ts` を import しない(向きは `eq-world.ts` → ここ → 型の葉)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { anonymousRoleId, globalRoleId, impliedRoles, systemRoleId } from '../model/role-hierarchy.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import { unreachable } from './rls-world-derivable.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import { buildBranch, withValues } from './rls-world-rows.js';
import { holdingValues, unmetGateRoles } from './rls-world-claims.js';
import type { EqActor, EqRoleArray, EqWorldInput } from './eq-world-types.js';
import { NO_ROW_SUFFIX, STALE_ARRAY_NAME, UNMET_SUFFIX } from './eq-world-types.js';

/** 控えの行を組み立てた結果。 */
export type SpareResult =
  | { readonly ok: true; readonly rows: readonly RlsWorldRow[] }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/**
 * 実行者の並び(役ごとに 1 人 + 既定 + 行が無い人)。
 *
 * ロール配列は人ごとに組む —— `resolved` は実行器が session から解決して渡すものと同じ形
 * (既定のログインロールと、その人に立つ `claim` の役を `implies` で閉じたもの)であり、
 * 立つ役が人によって違う以上、配列も人によって違う。
 */
export function actorsOf(input: EqWorldInput, aggregate: string): readonly EqActor[] {
  const roles = input.domain.roles.roles;
  const authenticated = globalRoleId(roles, 'authenticated_default');
  const actorEntityName = actorEntity(input.domain) ?? '';
  const actors: EqActor[] = [];
  const add = (key: string, role: string, basis: EqActor['basis'], claims: readonly string[]): void => {
    actors.push({
      key,
      role,
      basis,
      row: `${key}:${actorEntityName}`,
      target: `${key}:${aggregate}`,
      arrays: arraysOf(input.domain, claims, true),
    });
  };
  for (const role of [...input.bindingRoles.keys()].sort()) add(role, role, 'binding', []);
  for (const role of [...input.claimRoles].sort()) add(role, role, 'claim', [role]);
  if (authenticated !== undefined && !actors.some((candidate) => candidate.key === authenticated)) {
    add(authenticated, authenticated, 'default', []);
  }
  if (authenticated === undefined) return actors;
  return [
    ...actors,
    ...actors.flatMap((actor) => unmetActorsOf(input.domain, actor, aggregate)),
    {
      key: `${authenticated}${NO_ROW_SUFFIX}`,
      role: authenticated,
      basis: 'no_row',
      row: null,
      target: null,
      arrays: arraysOf(input.domain, [], false),
    },
  ];
}

/**
 * 根拠は成立しているが、行の条件(既定のログインロールの条件・含意の先の条件。ADR-0018)を満たさない人。
 *
 * 渡すロール配列は 2 通り。実行器がセッションから解決するもの(`from_session`。既定のログインロールを持たない側の
 * 未ログインのロールで、`claim` のロールも含まない)と、**古いロール一覧**(`from_stale`。条件を満たしていた頃の配列
 * ——既定のログインロールと、`claim` の役ならそのロール。DB が配列を信じず行の条件で落とすことを、実 DB で見張る)。
 * ほかの 2 通り(内部実行 / 渡さない)は条件に関係なく同じ結果なので、実行者を増やしても組み合わせを増やすだけである。
 * 条件を宣言していなければ空(world は従来と同じ)。
 *
 * @param domain ドメイン仕様
 * @param actor 通常の実行者
 * @param aggregate 対象の集約(その系統の対象の行の名前に使う)
 * @returns 条件を満たさない人(条件を持つロールごとに 1 人)
 */
function unmetActorsOf(domain: SpecModel, actor: EqActor, aggregate: string): readonly EqActor[] {
  if (actor.row === null) return [];
  return unmetGateRoles(domain, actor.role).map((gate) => {
    const key = `${actor.key}${UNMET_SUFFIX}${gate}`;
    return {
      ...actor,
      key,
      row: `${key}:${actorEntity(domain) ?? ''}`,
      target: `${key}:${aggregate}`,
      arrays: [
        ...arraysOf(domain, [], false).filter((array) => array.name === 'from_session'),
        { name: STALE_ARRAY_NAME, roles: staleRolesOf(domain, actor.basis === 'claim' ? [actor.role] : []) },
      ],
      unmet: gate,
    };
  });
}

/**
 * 古いロール一覧(条件を満たしていた頃に解決された配列)。既定のログインロールと `claim` のロールを `implies` で閉じる。
 *
 * @param domain ドメイン仕様
 * @param claims その人の `claim` のロール
 * @returns ロール配列の中身
 */
export function staleRolesOf(domain: SpecModel, claims: readonly string[]): readonly string[] {
  const authenticated = globalRoleId(domain.roles.roles, 'authenticated_default');
  return closure(domain, [...(authenticated === undefined ? [] : [authenticated]), ...claims]);
}

/**
 * その人が渡すロール配列の 3 通り(解決済み / システム / 渡さない)。
 *
 * **実行者の集約に行が無い人には既定のログインロールが立たない。** 既定のログインロール
 * (`kind: authenticated_default`)の根拠は「認証済みであること」ではなく「実行者の集約に
 * その人の行があること」であり(domain-spec-writing.md §role_spec)、実行器も行の写しである
 * セッションのプロフィールの有無でそれを立てる。行の無い人が渡せるのは未ログインのロール
 * だけである —— そうしないと「権限は素通りし、止めているのは外部キーだけ」が期待の側にも
 * 写ってしまう(束 ⑳-5a の所見 ①)。
 *
 * @param domain ドメイン仕様
 * @param claims その人に立つ `claim` の役
 * @param hasRow 実行者の集約にその人の行があるか
 * @returns ロール配列の 3 通り
 */
export function arraysOf(
  domain: SpecModel,
  claims: readonly string[],
  hasRow: boolean,
): readonly EqRoleArray[] {
  const roles = domain.roles.roles;
  const authenticated = hasRow ? globalRoleId(roles, 'authenticated_default') : anonymousRoleId(roles);
  const system = systemRoleId(roles);
  const seeds = [...(authenticated === undefined ? [] : [authenticated]), ...(hasRow ? claims : [])];
  return [
    { name: 'from_session', roles: closure(domain, seeds) },
    { name: 'from_runtime', roles: system === undefined ? [] : closure(domain, [system]) },
    { name: 'empty', roles: [] },
  ];
}

/** `implies`(持てば必ず持つ)で閉じる。 */
function closure(domain: SpecModel, seeds: readonly string[]): readonly string[] {
  const found = new Set<string>(seeds);
  for (const seed of seeds) {
    for (const implied of impliedRoles(domain.roles.roles, seed)) found.add(implied);
  }
  return [...found];
}

/**
 * `claim` の役ごとに置く**控えの行**(その役を外せる world にするため)。
 *
 * 軸がその役の含意の側(「その欄が真ならこの欄はこう」)と違う値を置こうとすると、前提の
 * 側を外す(`eq-cases.ts` の含意の緩和)。ところが**その役の人が world に 1 人しかいない**と、
 * 下限を宣言した不変条件(「0 人にはできない」)がその取り外しを止める —— world が狭いせいで
 * 実行できない組み合わせが生まれる。
 *
 * そこで役ごとに、誰の実行者でもない行を 1 つだけ足す。実行する相手にも実行者にもならないので、
 * 判定には一切効かない —— 効くのは「外しても 0 人にならない」ことだけである。
 */
export function spareRows(
  input: EqWorldInput,
  actorEntity_: string,
  at: {
    readonly next: () => number;
    readonly places: readonly { readonly entity: string; readonly column: string }[];
    readonly table: DataTableSpec;
    readonly tableOf: (entity: string) => string | null;
  },
): SpareResult {
  const rows: RlsWorldRow[] = [];
  for (const role of input.claimRoles) {
    const held = holdingValues(input.domain, role);
    if (Object.keys(held).length === 0) continue;
    const key = `${role}_spare`;
    const built = buildBranch(
      {
        domain: input.domain,
        tableOf: at.tableOf,
        defaultsOf: (name) => input.tables.find((candidate) => candidate.entity === name)?.defaults ?? {},
        actorEntity: actorEntity_,
        requiredFields: () => [],
        boundColumns: (name) => at.places.filter((place) => place.entity === name).map((place) => place.column),
        ownBinding: null,
        next: at.next,
      },
      key,
      actorEntity_,
    );
    if (!built.ok) {
      return { ok: false, problems: built.unreachable.map((name) => unreachable(at.table, name)) };
    }
    for (const row of built.branch.rows) {
      rows.push({ ...(row.entity === actorEntity_ ? withValues(row, held) : row), actor: null });
    }
  }
  return { ok: true, rows };
}

