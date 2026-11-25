/**
 * 操作 ID をドメイン仕様へ接地させる(意味解析の層)。
 *
 * 検証器(Y 群・V18)・導出(操作の属性・数えた面倒)・生成器(画面・文書・実行計画)が
 * **同じ接地結果**を読むための 1 か所。ここは仕様のモデルだけを読む純粋関数で、出力の形も
 * 文言も知らない(接地結果の表記は出力側 `generate/render/spec-body.ts` が持つ)。
 */

import type { SpecModel } from '../model/types.js';
import {
  findCreate,
  findDelete,
  findEvent,
  findUpdate,
  isCreateId,
  isDeleteId,
  isUpdateId,
  type CreateEntry,
  type DeleteEntry,
  type EventEntry,
  type UpdateEntry,
} from './domain-index.js';

/**
 * 操作 ID(`{machine}.{event}` / 予約 ID)のドメイン仕様への接地結果。
 *
 * 予約 ID(create / delete / update)は access_spec に、それ以外は state_spec に接地する
 * (A1 と同じ規則)。`unknown` は接地先が見つからない状態で、verify 通過後には現れない。
 */
export type OperationGrounding =
  | { readonly kind: 'transition'; readonly entry: EventEntry }
  | { readonly kind: 'create'; readonly entry: CreateEntry }
  | { readonly kind: 'delete'; readonly entry: DeleteEntry }
  | { readonly kind: 'update'; readonly entry: UpdateEntry }
  | { readonly kind: 'unknown' };

/**
 * 操作 ID をドメイン仕様に接地させる(A1 と同じく予約 ID を先に判定する)。
 *
 * @param model ドメイン仕様全体
 * @param id `{machine}.{event}` または `{entity}.{create|delete|update}` 形式の ID
 * @returns 接地結果。見つからなければ kind: 'unknown'
 */
export function groundOperation(model: SpecModel, id: string): OperationGrounding {
  if (isCreateId(id)) {
    const entry = findCreate(model, id);
    return entry === null ? { kind: 'unknown' } : { kind: 'create', entry };
  }
  if (isDeleteId(id)) {
    const entry = findDelete(model, id);
    return entry === null ? { kind: 'unknown' } : { kind: 'delete', entry };
  }
  if (isUpdateId(id)) {
    const entry = findUpdate(model, id);
    return entry === null ? { kind: 'unknown' } : { kind: 'update', entry };
  }
  const entry = findEvent(model, id);
  return entry === null ? { kind: 'unknown' } : { kind: 'transition', entry };
}
