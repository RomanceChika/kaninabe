/**
 * U1 が「確認が要る操作」を決めるための接着剤。
 *
 * **確認が要るかの答えは 1 つだけ**である — 意味解析の層の `deriveOperationAttributes` の `confirmRequired`
 * (方針の式 `negativeTone ∨ destructive ∨ (irreversible ∧ affectsOthers) ∨ settles` に、action_spec の `ux` の
 * 上書きを適用したあと)。画面の生成・S19・Y5・ハンドブックがこれを読むので、U1 も同じものを読む。
 * U1 が自前で「終端への遷移・物理削除・戻る遷移が無い遷移」を数えていた(2 系統の導出)のは、
 * 画面は確認を出すのに U1 は黙る / その逆、という食い違いを生むのでやめた。
 */

import type { SpecModel } from '../model/types.js';
import { canonicalActionId } from '../semantics/action-ground.js';
import { deriveOperationAttributes, type OperationAttributes } from '../semantics/operation-attributes.js';
import type { ActionSpec } from '../model/trace/types.js';
import { actionsOf, type UxContext } from './context.js';

/**
 * 操作の属性(確認の要否を含む)を、画面の生成と同じ導出で引く。
 *
 * @param domain ドメイン仕様全体
 * @param ctx カタログと action_spec を持つ文脈(省略分は「まだ無い」として扱う)
 * @param id 正規化済みの操作 ID
 */
export function attributesOf(domain: SpecModel, ctx: UxContext, id: string): OperationAttributes {
  return deriveOperationAttributes(domain, ctx.catalogs ?? {}, id, actionSpecOf(domain, ctx, id));
}

/** 操作 ID の action_spec(`handles` が別名で書かれていても正規化して引く)。無ければ undefined。 */
function actionSpecOf(domain: SpecModel, ctx: UxContext, id: string): ActionSpec | undefined {
  return actionsOf(ctx)?.actions.find((action) => (canonicalActionId(domain, action.handles.raw) ?? action.handles.raw) === id);
}

/**
 * 確認が要る理由(指摘文にそのまま出す)。方針の式のどの項が成り立ったかを、成り立った順に並べる。
 *
 * 上書き(`ux: { confirm: required }`)で要るとされた操作は、式が成り立たなくても上書きが理由になる。
 *
 * @param attrs 導出した属性
 */
export function confirmReason(attrs: OperationAttributes): string {
  const reasons = [
    ...(attrs.negativeTone ? ['負の意味の状態への遷移'] : []),
    ...(attrs.destructive ? ['取り返しのつかない削除・個人データの消去'] : []),
    ...(attrs.irreversible && attrs.affectsOthers ? ['戻る遷移が無く、他の人にも影響する'] : []),
    ...(attrs.settles ? [`${attrs.settlesLabels.join('・') || '値'}を確定させる遷移`] : []),
  ];
  if (reasons.length > 0) return reasons.join(' / ');
  return attrs.overridden ? 'action_spec の ux で確認を要るとしている' : '確認が要る導出';
}
