/**
 * 「人間が起こせる操作」の絞り込み。
 *
 * A4(ハンドラの網羅)と S10(UI 到達の網羅)は、どちらも**人間ロールが実行できる操作**を
 * 母集合にする。どのロールを人間と見なすかの判定(`isHumanRole`)が検証器ごとに散ると、
 * 同じ「母集合」と言いながら中身が黙ってずれる。絞り込みだけをここに置く。
 *
 * **どの種類を母集合に含めるかは各検証器が決める。** A4 は編集(`writes`)を数えず
 * (「宣言 1 本 = Server Action 1 本」と機械的に言えないため。a4-handler-coverage.ts)、
 * S10 は数える(粒度に関係なく「編集する画面が 1 枚も無い」ことは言えるため)。
 */

import type { SpecModel } from '../model/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';
import type { AccessOpEntry, CreateEntry, DeleteEntry, EventEntry, UpdateEntry } from '../semantics/domain-index.js';
import { isHumanRole, listCreates, listDeletes, listEvents, listUpdates } from '../semantics/domain-index.js';

/** 人間ロールが起こせる遷移イベントだけを列挙する。 */
export function listHumanEvents(model: SpecModel): EventEntry[] {
  const systemRole = systemRoleId(model.roles.roles);
  return listEvents(model).filter((entry) => entry.event.by.some((id) => isHumanRole(id, systemRole)));
}

/** access_spec の規則のうち人間ロールのものが 1 件以上ある宣言だけを残す。 */
function withHumanRule<TRule extends { readonly by: string }>(
  entries: readonly AccessOpEntry<TRule>[],
  systemRoleId: string | undefined,
): AccessOpEntry<TRule>[] {
  return entries.filter((entry) => entry.rules.some((rule) => isHumanRole(rule.by, systemRoleId)));
}

/** 人間ロールが作成できるエンティティ(`{entity}.create`)を列挙する。 */
export function listHumanCreates(model: SpecModel): CreateEntry[] {
  return withHumanRule(listCreates(model), systemRoleId(model.roles.roles));
}

/** 人間ロールが削除できるエンティティ(`{entity}.delete`)を列挙する。 */
export function listHumanDeletes(model: SpecModel): DeleteEntry[] {
  return withHumanRule(listDeletes(model), systemRoleId(model.roles.roles));
}

/** 人間ロールが編集できるエンティティ(`{entity}.update`)を列挙する。 */
export function listHumanUpdates(model: SpecModel): UpdateEntry[] {
  return withHumanRule(listUpdates(model), systemRoleId(model.roles.roles));
}
