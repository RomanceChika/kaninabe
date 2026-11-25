/**
 * RLS の挙動テストのオラクルに渡す**ロールの根拠**(束 ⑳-4b)。
 *
 * オラクル(実行する側の TS)は「この実行者はこのロールで立つか」を、world の行を見て自分で
 * 判定する —— SQL の述語を読むのでも、翻訳器を呼ぶのでもない。そのために要るのがこの事実表で
 * ある: 未ログインか / ログインしていれば常に立つか / 実行者自身の行のどの欄が根拠か /
 * **対象の行のどの集約のどの列を実行者と比べるか** / 何を含意するか。
 *
 * 束縛(`binding`)をここで「集約 + 列」に開くのは、オラクルが**参照の道を辿り直さない**ため
 * である。world の行は自分の祖先(集約 → 行)を持っているので、束縛が指す集約の行はそこから 1 手で
 * 引ける —— SQL 側が EXISTS を何段に畳んだかに依らない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, SpecModel } from '../model/types.js';
import { pathKey } from '../guard/atoms.js';
import { parseGuard } from '../guard/parser.js';
import { anonymousRoleId, globalRoleId, systemRoleId } from '../model/role-hierarchy.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { claimPartsOf } from '../model/role-claim.js';
import { unmetGateRoles } from './rls-world-claims.js';
import { needsBoundaryHelper } from './rls-boundary.js';
import { resolveReadFilter } from '../model/read-filter-path.js';

/** `binding` の右辺に書ける唯一のパス(V11)。 */
const ACTOR_ID_PATH = 'actor.id';

/** 「別の境界を持つもう 1 人」の名前に足す接尾(境界を宣言した表だけに現れる)。 */
const OTHER_SUFFIX = '_other';

/** 「根拠は成立しているが行の条件を満たさない人」の名前に足す接尾(続けて条件を持つロールの ID が付く)。 */
const UNMET_SUFFIX = '_unmet_';

/** 「ログインしているが実行者の集約に行が無い人」の名前に足す接尾。 */
const WITHOUT_ROW_SUFFIX = '_without_row';

/** 束縛が見る場所。 */
export interface RlsWorldBinding {
  /** その列を持つ集約。 */
  readonly entity: string;
  /** 実行者と比べる列。 */
  readonly column: string;
  /** その列が実行者の集合なら true(`contains actor.id`)。 */
  readonly many: boolean;
}

/** ロール 1 つの根拠。 */
export interface RlsWorldRole {
  readonly id: string;
  /** 未ログインの実行者に対応するロールか。 */
  readonly anonymous: boolean;
  /** RLS をバイパスする内部実行ロールか(ポリシーも `grant` も持たない)。 */
  readonly system: boolean;
  /** 実行者の集約に行があれば必ず立つか(`kind: authenticated_default`)。 */
  readonly authenticatedDefault: boolean;
  /** 実行者自身の行の欄が根拠(または既定のログインロールの条件)なら、その欄名。 */
  readonly claimField: string | null;
  /**
   * `claimField` が state / enum の欄のときの、立つ値の集合(ADR-0018)。
   * boolean の欄(従来の `claim`)なら持たない。既定のログインロールでは「行がある」に **AND** で課される条件になる。
   */
  readonly claimValues?: readonly string[];
  /** 対象の行との関係が根拠なら、その場所。 */
  readonly binding: RlsWorldBinding | null;
  /** このロールを持つと必ず持つロール。 */
  readonly implies: readonly string[];
}

/**
 * 全ロールの根拠(world に依らないので 1 度だけ出す)。
 *
 * @param domain ドメイン仕様
 * @returns ロールごとの根拠(宣言順)
 */
export function rlsWorldRoles(domain: SpecModel): readonly RlsWorldRole[] {
  const anonymous = anonymousRoleId(domain.roles.roles);
  const authenticated = globalRoleId(domain.roles.roles, 'authenticated_default');
  const system = systemRoleId(domain.roles.roles);
  return domain.roles.roles.map((role) => {
    const claim = claimPartsOf(role);
    return {
      id: role.id,
      anonymous: role.id === anonymous,
      system: role.id === system,
      authenticatedDefault: role.id === authenticated,
      claimField: claim?.field ?? null,
      // 値の集合は持つときだけ出す(boolean の claim・条件の無いロールの生成物は変わらない)。
      ...(claim?.values == null ? {} : { claimValues: claim.values }),
      binding: role.binding === undefined ? null : bindingFact(role.binding),
      implies: role.implies ?? [],
    };
  });
}

/**
 * 任意の欄でも world の行に値が要るもの(ロールの束縛の列・境界の列)。
 *
 * 値の写像は必須の欄しか埋めないが、**束縛と境界の列は必須でなくても埋めなければならない** ——
 * そこが空のままでは、そのロールで立つ行が world に 1 つも無いことになる。
 *
 * @param domain ドメイン仕様
 * @param access 対象の集約のアクセス宣言
 * @returns 集約 → 埋める欄名(宣言順・重複なし)
 */
export function boundFields(
  domain: SpecModel,
  access: AccessSpec,
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  const add = (entity: string, field: string): void => {
    const list = found.get(entity) ?? [];
    if (!list.includes(field)) list.push(field);
    found.set(entity, list);
  };
  for (const role of rlsWorldRoles(domain)) {
    if (role.binding !== null) add(role.binding.entity, role.binding.column);
  }
  const actor = actorEntity(domain);
  for (const rule of access.reads) {
    for (const filter of rule.filters ?? []) {
      // 実行者の側の欄も埋める(境界の値の出どころ。任意の欄でも空のままでは境界が 1 通りに潰れる)。
      if (actor !== null && needsBoundaryHelper(filter.actorField)) add(actor, filter.actorField);
      const resolution = resolveReadFilter(domain, access.entity, filter);
      if (!resolution.ok) continue;
      // 親の列なら、そこへ辿る参照列も埋める(空のままでは親の行が world に置かれない)。
      const { via, route, entity, field } = resolution.resolved;
      for (const [index, column] of via.entries()) add(index === 0 ? access.entity : (route[index - 1] ?? ''), column);
      add(entity, field.name);
    }
  }
  return found;
}

/**
 * 束縛が名指しする場所の全数(集約 + 列。重複なし)。
 *
 * world の行を組み立てる側がこれを要るのは、**同じ相手を指す参照が 2 本ある形**で行を 1 つに
 * 畳んでしまわないためである —— 2 本の束縛が同じ行の同じ相手を指せば、どちらの束縛も必ず
 * 同時に立ち、「片方だけが立つ」を区別できない world になる(`rls-world-rows.ts` の `splitFields`)。
 *
 * @param domain ドメイン仕様
 * @returns 束縛が見る場所(宣言順・重複なし)
 */
export function bindingPlaces(domain: SpecModel): readonly RlsWorldBinding[] {
  const found: RlsWorldBinding[] = [];
  for (const role of rlsWorldRoles(domain)) {
    const binding = role.binding;
    if (binding === null) continue;
    if (found.some((place) => place.entity === binding.entity && place.column === binding.column)) continue;
    found.push(binding);
  }
  return found;
}

/** 束縛が見る場所(`{集約}.{列} == actor.id` / `… contains actor.id` の 2 形)。 */
function bindingFact(binding: string): RlsWorldBinding | null {
  const parsed = parseGuard(binding);
  if (!parsed.ok) return null;
  const expr = parsed.expr;
  if (expr.kind === 'compare' && expr.op === '==' && expr.rhs.kind === 'path') {
    return pathKey(expr.rhs.path) === ACTOR_ID_PATH ? placeOf(expr.path.segments, false) : null;
  }
  if (expr.kind === 'contains') {
    return pathKey(expr.ref) === ACTOR_ID_PATH ? placeOf(expr.path.segments, true) : null;
  }
  return null;
}

/** `{集約}.{列}` のパスを束縛の場所に写す。 */
function placeOf(segments: readonly string[], many: boolean): RlsWorldBinding | null {
  const [entity, column] = segments;
  if (segments.length !== 2 || entity === undefined || column === undefined) return null;
  return { entity, column, many };
}

/** 実行者 1 人。 */
export interface RlsWorldActor {
  readonly key: string;
  /** その実行者が代表するロール(検査の見出しに出る)。 */
  readonly role: string;
  readonly anonymous: boolean;
  /** その実行者の集約の行の名前(未ログイン、または**行を持たない人**なら `null`)。 */
  readonly row: string | null;
  /**
   * この人が**条件を満たさない**ロール(ADR-0018)。根拠(束縛など)は成立しているが、このロールの
   * 行の条件(既定のログインロールの条件・含意の先の条件)だけを満たさない —— その行の欄には条件の外の値が
   * 置かれる。条件を満たす人(通常の実行者)は持たない。
   */
  readonly unmet?: string;
}

/**
 * 作る実行者(ポリシーに現れるロール + 束縛の無い既定のログイン実行者 + 未ログイン)。
 *
 * ポリシーに現れないロールの実行者は作らない —— その表を読める根拠が 1 つも無い人を何人
 * 並べても、同じ「0 行」を何度も確かめるだけである。既定のログイン実行者と未ログインは、
 * どの表でも「読めない側」を見るために必ず要る。
 *
 * **境界(`filters`)を宣言した表にはもう 1 人足す。** 実行者が 1 人しかいない world には「別の
 * テナントの行」が存在しないので、境界の条件を落としたポリシーでも検査が通ってしまう(T4 が
 * 塞ぎたかった形そのものである)。既定のログインロールの 2 人目を置けば、系統が違う = 境界の値が
 * 違う行が必ず world にある。
 *
 * **どの表にも「ログインしているが実行者の集約に行が無い人」を 1 人足す。** `kind:
 * authenticated_default` の根拠は「実行者の集約に行があること」であり、生成される補助関数が
 * 見ているのもそれである —— 行を持つ人しか world に居なければ、その判定は 1 度も実行されない
 * (述語を `using (true)` に潰しても、全ロールが `scope: all` の表では検査が通ってしまう)。
 * 招待を受け取っただけの認証ユーザは本番に実在する状態であり、発明ではない。
 *
 * @param domain ドメイン仕様
 * @param access 対象の集約のアクセス宣言
 * @param byRoles ポリシーに現れるロール(刈り込み後)
 * @returns 実行者(宣言順。境界を宣言した表には「もう 1 人」、末尾に「行が無い人」が付く)
 */
export function actorsOf(
  domain: SpecModel,
  access: AccessSpec,
  byRoles: readonly string[],
): readonly RlsWorldActor[] {
  const roles = domain.roles.roles;
  const anonymous = anonymousRoleId(roles);
  const authenticated = globalRoleId(roles, 'authenticated_default');
  const system = systemRoleId(roles);
  const wanted = [...byRoles];
  for (const role of [authenticated, anonymous]) {
    if (role !== undefined && !wanted.includes(role)) wanted.push(role);
  }
  const actors = wanted
    .filter((role) => role !== system && access.reads.some((rule) => rule.by === role))
    .map((role) => actorOf(domain, role, role, role === anonymous));
  if (authenticated === undefined) return actors;
  const bounded = access.reads.some((rule) => (rule.filters ?? []).length > 0);
  const other = bounded ? [actorOf(domain, `${authenticated}${OTHER_SUFFIX}`, authenticated, false)] : [];
  // 行の条件(ADR-0018)を満たさない人を、条件を持つロールごとに足す。条件を宣言していなければ空。
  const unmet = actors.flatMap((actor) => unmetActorsOf(domain, actor));
  // 行を持たない人は系統を持てない(その系統の行はすべて実行者の行から遡って作られる)ので、
  // `row: null` で「ログインしているが行が無い」を表す。未ログインとの違いは `anonymous` である。
  const withoutRow: RlsWorldActor = {
    key: `${authenticated}${WITHOUT_ROW_SUFFIX}`,
    role: authenticated,
    anonymous: false,
    row: null,
  };
  return [...actors, ...other, ...unmet, withoutRow];
}

/**
 * 条件を満たさない人(その人と同じ根拠で、含意の先の行の条件・既定のログインロールの条件だけを満たさない)。
 *
 * 根拠が成立しているのに条件で止まることを確かめるための人であり、ポリシーが条件を落とすと見えてしまう行を
 * 必ず world に置く(含意の先の条件を落とした翻訳でも、通常の実行者だけでは緑のままになる)。
 */
function unmetActorsOf(domain: SpecModel, actor: RlsWorldActor): readonly RlsWorldActor[] {
  if (actor.row === null) return [];
  return unmetGateRoles(domain, actor.role).map((gate) => ({
    ...actorOf(domain, `${actor.key}${UNMET_SUFFIX}${gate}`, actor.role, false),
    unmet: gate,
  }));
}

/** 実行者 1 人を組み立てる(`key` が world の中の名前、`role` がその人が代表するロール)。 */
function actorOf(domain: SpecModel, key: string, role: string, anonymous: boolean): RlsWorldActor {
  return {
    key,
    role,
    anonymous,
    row: anonymous ? null : `${key}:${actorEntity(domain) ?? ''}`,
  };
}
