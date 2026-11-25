/**
 * 操作 ID をドメイン仕様へ接地させたときの事実(意味解析の層)。
 *
 * 画面(S 群)・UX 経験則(U 群)・ユースケース・生成器が「書かれた操作 ID が何に接地するか・
 * 誰が実行できるか」を同じ答えで読むための 1 か所。**画面の宣言を 1 つも読まない**(仕様のモデルだけを
 * 読む純粋関数)ので、画面の種類のディレクトリに置かず、種類に属さない共有の事実として置く
 * (設計メモ framework-modules §13。かつては `screen/lookup.ts` にいて、U 群が画面の置き場を読んでいた)。
 * 接地の結果そのもの(`OperationGrounding`)は `operation-ground.ts`。
 */

import type { SpecModel } from '../model/types.js';
import { impliedRoles } from '../model/role-hierarchy.js';
import {
  findCreate,
  findDelete,
  findEvent,
  findUpdate,
  isCreateId,
  isDeleteId,
  isUpdateId,
} from './domain-index.js';

/**
 * `actions` の 1 件がドメイン仕様に接地するか。
 *
 * 接地先は 2 種類ある(action-spec-writing.md の `handles` と同じ規則)。
 * - 状態機械のイベント `{machine}.{event}`
 * - 予約 ID `{entity}.create` / `.delete` / `.update`(接地先は access_spec)
 *
 * @param domain ドメイン仕様全体
 * @param id 画面が発火すると宣言した操作の ID
 * @returns 接地していれば true
 */
export function isGroundedAction(domain: SpecModel, id: string): boolean {
  return actionRoles(domain, id) !== null;
}

/**
 * その操作を実行できるロールを引く。
 *
 * @param domain ドメイン仕様全体
 * @param id ドメインイベント ID または予約 ID
 * @returns 実行できるロール ID(接地しない ID なら null)
 */
export function actionRoles(domain: SpecModel, id: string): readonly string[] | null {
  const event = findEvent(domain, id);
  if (event !== null) return event.event.by;
  if (isCreateId(id)) return rulesBy(findCreate(domain, id)?.rules);
  if (isDeleteId(id)) return rulesBy(findDelete(domain, id)?.rules);
  if (isUpdateId(id)) return rulesBy(findUpdate(domain, id)?.rules);
  return null;
}

/**
 * 書かれた操作 ID を、ドメイン仕様が持つ**正式な ID** に正規化する。
 *
 * 予約 ID は「集約ディレクトリ名」でも「`access_spec` の entity 名」でも引ける
 * (`domain-index.ts` の findAccessOp)。`program` ディレクトリの entity が `program_item` なら、
 * `program.create` と `program_item.create` は**同じ操作の別名**であり、S2 / S4 はどちらも
 * 接地として受け入れる。集合演算(S10 の到達済み集合と免除宣言の突合)で名前をそのまま使うと、
 * 別名で書かれた側が「未到達」「存在しない操作」に化ける。突き合わせる前にここを通す。
 *
 * @param domain ドメイン仕様全体
 * @param id 画面や免除宣言に書かれた操作 ID
 * @returns 正式な ID。接地しない ID なら null
 */
export function canonicalActionId(domain: SpecModel, id: string): string | null {
  const event = findEvent(domain, id);
  if (event !== null) return event.id;
  if (isCreateId(id)) return findCreate(domain, id)?.id ?? null;
  if (isDeleteId(id)) return findDelete(domain, id)?.id ?? null;
  if (isUpdateId(id)) return findUpdate(domain, id)?.id ?? null;
  return null;
}

/** access_spec の規則から by のロールを取り出す。宣言そのものが無ければ null。 */
function rulesBy(rules: readonly { readonly by: string }[] | undefined): readonly string[] | null {
  return rules === undefined ? null : rules.map((rule) => rule.by);
}

/**
 * 画面のロールのうち、その操作を実行し得るものがあるか。
 *
 * 「実行し得る」は**ロール階層まで見て**判定する。`entry.submit` の `by` は `performer` だが、
 * `performer: implies [member]` なので「メンバー向けの画面から発表者としての操作を出す」ことは成立する
 * (query_spec の `via` の借用条件①と同じ考え方)。
 *
 * @param domain ドメイン仕様全体
 * @param forRoles 画面の `for`
 * @param byRoles その操作の実行ロール
 * @returns 交差があれば true
 */
export function rolesIntersect(
  domain: SpecModel,
  forRoles: readonly string[],
  byRoles: readonly string[],
): boolean {
  return byRoles.some((by) => {
    if (forRoles.includes(by)) return true;
    const implied = impliedRoles(domain.roles.roles, by);
    return forRoles.some((role) => implied.has(role));
  });
}
