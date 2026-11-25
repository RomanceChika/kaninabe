/**
 * 「この操作を許されたロールごとに、そのロールとして成功するテストが要る」の導出。
 *
 * A7 の後半(ロールの義務)の判定基準そのものであり、action-spec-writing.md §by_role が正である。
 * 意味クラスの導出(required-coverage.ts)と分けてあるのは、問いが違うからである ——
 * あちらは「確かめるべきことが宣言されているか」、こちらは**実装が宣言のロールを解決しているか**を問う。
 */

import { isHumanRole } from '../semantics/domain-index.js';

/** 権限規則のうち、この導出が読む部分(creates / deletes / writes 共通)。 */
export interface AccessRuleLike {
  readonly by: string;
}

/** 「このロールとして成功するケースが要る」1 件と、その根拠。 */
export interface RequiredRole {
  /** roles.md のロール ID。 */
  readonly role: string;
  /** なぜ必要か(メッセージにそのまま埋め込む日本語の句)。 */
  readonly because: string;
}

/**
 * access_spec の規則に並ぶロール(重複を畳んで宣言順)。
 *
 * @param rules creates / deletes / writes のいずれかの規則列
 * @param where 根拠の句に埋める場所の名前(例: "entry.update の writes")
 * @param systemRoleId 内部実行のロール ID(role_spec の `kind: system`。無ければ `undefined`)
 */
export function ruleRoles(
  rules: readonly AccessRuleLike[],
  where: string,
  systemRoleId: string | undefined,
): readonly RequiredRole[] {
  return uniqueRoles(
    rules.map((rule) => rule.by),
    where,
    systemRoleId,
  );
}

/**
 * state_spec の `by` に並ぶロール。
 *
 * @param by イベントの実行ロール
 * @param where 根拠の句に埋める場所の名前(例: "entry.submit の by")
 * @param systemRoleId 内部実行のロール ID(role_spec の `kind: system`。無ければ `undefined`)
 */
export function eventRoles(
  by: readonly string[],
  where: string,
  systemRoleId: string | undefined,
): readonly RequiredRole[] {
  return uniqueRoles(by, where, systemRoleId);
}

/**
 * ロール ID を重複なく並べ、根拠の句を添える。
 *
 * 内部実行のロール(role_spec の `kind: system`)を外すのは、内部実行の経路には
 * Server Action の入口が無く、「誰が起こすのか」を A10(system が起こすイベントの走査実装の宣言)が
 * 別に見ているためである。ここで要求すると、宣言上 system が書ける列(料金の確定が書く
 * `flat_surcharge_amount` など)について「その集約の update 操作を system として成功させる
 * テスト」という**実在しない経路**のテストを求めることになる。
 */
function uniqueRoles(
  ids: readonly string[],
  where: string,
  systemRoleId: string | undefined,
): readonly RequiredRole[] {
  return [...new Set(ids)]
    .filter((role) => isHumanRole(role, systemRoleId))
    .map((role) => ({ role, because: `${where} に並んでいる` }));
}
