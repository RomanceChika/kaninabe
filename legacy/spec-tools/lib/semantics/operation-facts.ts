/**
 * 操作の属性の導出(operation-attributes.ts)が使う、純粋な事実抽出関数の置き場。
 *
 * 状態機械の到達可能性・ロールの binding・遷移が空にする個人列・通知の宛先種別を
 * 引く(連鎖 = 同じトランザクションで他の行に及ぶ書き込みは `operation-cascade.ts`)。どれも仕様のモデルとカタログだけを読む純粋関数で、文言(日本語)も出力の形も知らない。
 * 文言は出力側(`messages/messages.ts`)が、ここで返した事実から組み立てる。
 */

import type { EntitySpec, EventDef, RoleDef, SpecModel, StateMachineSpec } from '../model/types.js';
import { globalRoleId, systemRoleId } from '../model/role-hierarchy.js';
import type { NotificationRecipientKind } from '../model/notification/types.js';
import { findField } from './domain-index.js';
import type { InputFieldRef } from '../model/trace/types.js';
import type { OperationCatalogs } from './operation-catalogs.js';

/** 状態機械 1 本ぶんの前後関係グラフで、ある状態から到達できる状態の集合(BFS)。 */
export function reachableFrom(machine: StateMachineSpec, start: string): ReadonlySet<string> {
  const outgoing = new Map<string, string[]>();
  for (const event of machine.events) {
    for (const from of event.from) {
      const list = outgoing.get(from);
      if (list === undefined) outgoing.set(from, [event.to]);
      else list.push(event.to);
    }
  }
  const reached = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of outgoing.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** binding が `{aggregate}.{field} == actor.id` の形で、かつ対象が同じ集約を指すか。 */
function isOwnerRole(role: RoleDef | undefined, aggregate: string): boolean {
  if (role?.binding === undefined) return false;
  const match = /^([a-z][a-z0-9_]*)\./.exec(role.binding);
  return match !== null && match[1] === aggregate;
}

/** `by` のロールのうち、対象行の所有者でない実行者を含むか(affects_others の一部)。 */
export function hasNonOwnerRole(byRoles: readonly string[], roles: readonly RoleDef[], aggregate: string): boolean {
  const byId = new Map(roles.map((role) => [role.id, role]));
  return byRoles.some((id) => !isOwnerRole(byId.get(id), aggregate));
}

/**
 * `by` が認証ユーザーの既定ロール(role_spec の `kind: authenticated_default`)を含まないか
 * (privileged = 昇格したロールだけが実行できる)。
 *
 * ロール名に依らない導出 —— かつては `'staff'` を直接比較していたが、それだと「staff という
 * 名前のロールだけが特権」という体系側の決め打ちになる。既定ロールが `by` に無ければ、
 * 「ただログインしているだけでは実行できない(staff・特定行の所有者・system 等、何かしら昇格した
 * ロールが要る)」という事実は変わらないので、これを privileged の定義にする。
 * `by` が未接地(0 件)の操作は判定できないため false(unknownAttributes と同じ安全側)。
 *
 * @param byRoles この操作を実行できる `by` のロール ID(重複可)
 * @param roles roles.md の全ロール定義
 */
export function requiresElevatedRole(byRoles: readonly string[], roles: readonly RoleDef[]): boolean {
  if (byRoles.length === 0) return false;
  const authenticatedDefault = globalRoleId(roles, 'authenticated_default');
  if (authenticatedDefault === undefined) return false;
  return !byRoles.includes(authenticatedDefault);
}

/** guard 文字列に `now` を含むか、`by` に system(role_spec の `kind: system`)を含むか(scheduled)。 */
export function isScheduled(
  byRoles: readonly string[],
  guards: readonly (string | undefined)[],
  roles: readonly RoleDef[],
): boolean {
  const system = systemRoleId(roles);
  if (system !== undefined && byRoles.includes(system)) return true;
  return guards.some((guard) => guard !== undefined && /\bnow\b/.test(guard));
}

/** input(`{entity}.{field}` の並び)に personal 列が 1 つでもあるか(touches_personal)。 */
export function inputTouchesPersonal(model: SpecModel, input: readonly InputFieldRef[]): boolean {
  return input.some((ref) => findField(model, ref.entity, ref.field)?.personal === true);
}

/**
 * 通知 ID → 宛先種別(`recipient.kind`。フレームワーク固定の self/role/channel)。
 *
 * `audience` の具体的な語(`public_channel` 等)はこのアプリの事情なので比較しない ——
 * 「経路だけ(誰か 1 人という単位を持たない)」を表す `kind: channel` が
 * outbound(外部に公開・送信される)の判定に要る事実である。
 */
export function notificationRecipientKind(catalogs: OperationCatalogs, id: string): NotificationRecipientKind | undefined {
  const list = catalogs.notifications?.available === true ? catalogs.notifications.catalog?.notifications ?? [] : [];
  return list.find((n) => n.id === id)?.recipient.kind;
}

/**
 * 遷移が空にする列(state_spec の `clears`)のうち personal 列のもの(宣言順)。
 *
 * 遷移の RPC は `clears` の列を空で上書きする —— 個人列なら、その値はその遷移で消える(scrub と同じ重さ)。
 * 遷移の書き込みは自分の行の状態の更新だけと読むと、destructive / touches_personal が黙って落ちる。
 *
 * @param entity 遷移元の集約の entity_spec(無ければ空)
 * @param event 遷移
 * @returns 空にされる personal 列
 */
export function clearedPersonalColumns(entity: EntitySpec | undefined, event: EventDef): readonly string[] {
  const personal = new Set((entity?.fields ?? []).filter((field) => field.personal).map((field) => field.name));
  return (event.clears ?? []).filter((column) => personal.has(column));
}
