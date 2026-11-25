/**
 * 表 1 枚の **ACL の全数**(ロール → その表で持てる権限の集合)。
 *
 * ## なぜ計画と別に「全数」が要るのか
 *
 * 権限は形(列・制約)と違って、**間違っていても読み書きが失敗しない** —— 失敗の代わりに
 * 「できてはいけないことができる」になる。だから突合は**閉世界**でなければ意味が薄い:
 * 「宣言した権限が在る」だけでは、宣言していない権限が静かに付いている状態を素通しする。
 *
 * ところが**執行者は 2 つに分かれている**ので、どちらか片方の計画を見ても全数は言えない。
 *
 * | ロール | 正 | 執行者 |
 * |---|---|---|
 * | `anon` / `authenticated`(surface のロール) | access_spec の `reads` | `{n}_policies_{表}.sql`(`revoke all` → `grant select`) |
 * | `service_role`(特権ロール) | 仕組み(どの表でも同じ 1 組) | `{n}_grants.sql`(系に 1 本。`revoke all` → 4 権限) |
 *
 * ## 執行者は 2 つに分かれる(裁定 2026-09-23 / 置き場の裁定 2026-09-25)
 *
 * **役者が交わらない**ので、どちらのファイルが先に当たっても同じ ACL に収束する。
 * 1 つのファイルに寄せなかった理由は 2 つある:
 *
 * 1. **同じ文を 2 つの生成物が出すことになる**(片方が古い番号で凍る)。
 * 2. **可視性を変えただけで権限の migration の採番をやり直す**ことになる —— `reads` を 1 行
 *    足すと権限のバイト列が変わり、適用済みの migration が書き換わる(C23)。
 *    可視性と権限は別の軸であり、片方の変更でもう片方の歴史を動かしたくない。
 *
 * **ポリシーを 1 本も持たない表**(仕組みが持つ表と内部テーブル)は、surface のロールの既定権限を
 * 剥奪するのも権限の migration の仕事である —— そのぶんだけ、この表の ACL は
 * 「全部が権限の migration 由来」になる。
 *
 * ## 母集合は全部の表である
 *
 * 形の正が無くても**権限の正はある**(仕組みの 1 組である)。だから `ddl_migration` を
 * 宣言できない内部テーブルもここで ACL を言えるようにしてある —— `entity` を引けない表では
 * surface のロールが 1 つも権限を持たない、という答えがそのまま出る(`grants-migration.ts`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { SpecModel } from '../model/types.js';
import { policyGranteeRoles } from '../model/role-hierarchy.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import { PRIVILEGED_PRIVILEGES } from './ddl-guards.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { endUserRoles, privilegedRole } from './platform-sql.js';
import { policyPlans, type PolicyGrantee } from '../world/index.js';

/** surface のロールに与えうる唯一の権限(書き込みの直接経路は作らない。全書き込みは RPC を通る)。 */
const READ_PRIVILEGE = 'select';

/** 1 ロール分の ACL。 */
export interface RoleAcl {
  /** Postgres のロール名。 */
  readonly role: string;
  /** その表で持つべき権限の全数(SQL の語。**空 = 1 つも持たない**)。 */
  readonly privileges: readonly string[];
}

/**
 * ACL の閉世界に載るロール(宣言順。surface のロール → 特権ロール)。
 *
 * 表の所有者(`postgres`)は載らない —— 所有者は `relacl` に必ず自分への付与として現れ、
 * 剥奪も付与も仕様の対象ではない(`api-parity` が関数の `proacl` で所有者を外すのと同じ)。
 *
 * @param profile プラットフォームの設定(ロール名の写像)
 * @returns ロール名の並び
 */
export function aclRoles(profile: PlatformProfile): readonly string[] {
  return [...endUserRoles(profile), privilegedRole(profile)];
}

/**
 * その表の ACL の全数(**閉世界**。載らないロールは「権限を 1 つも持たない」ではなく
 * 「この体系の外」である)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様(`reads` とロールの根拠の出どころ)
 * @param profile プラットフォームの設定(ロール名の写像)
 * @returns ロールごとの権限(`aclRoles` の順。持たないロールも空の配列で載る)
 */
export function tableAcl(table: DataTableSpec, domain: SpecModel, profile: PlatformProfile): readonly RoleAcl[] {
  const readers = readGrantees(table, domain).map((grantee) => profile.roles[grantee]);
  const privileged = privilegedRole(profile);
  return aclRoles(profile).map((role) => ({
    role,
    privileges:
      role === privileged ? PRIVILEGED_PRIVILEGES : readers.includes(role) ? [READ_PRIVILEGE] : [],
  }));
}

/**
 * その表を `select` できる surface の役割(ポリシーの migration が `grant select` する宛先。DB のロール名は設定が引く)。
 *
 * 判定は**ポリシーの計画をそのまま引く** —— `grant` の宛先を別の規則で導くと、ポリシーが
 * 1 本も無いロールに権限だけが残る(あるいはその逆の)食い違いを宣言できてしまう。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 宛先の役割(重複なし)
 */
function readGrantees(table: DataTableSpec, domain: SpecModel): readonly PolicyGrantee[] {
  const access = table.entity === undefined ? null : findAccessSpec(domain, table.entity);
  if (access === null) return [];
  return [...new Set(policyPlans(access, table.table, domain.roles.roles).flatMap((plan) => policyGranteeRoles(plan.to)))];
}
