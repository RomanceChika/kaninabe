/**
 * UX 検証器に注入される共有サービス(UxContext)。
 *
 * 型の本体(`types.ts`。モデル層)から分けてあるのは、確認の要否の導出(意味解析の層)が読むカタログと
 * action_spec を持つ文脈だからで、下の層の型ファイルが上の層の型を読まないようにするためである。
 */

import type { GuardServices } from '../guard/ast.js';
import type { OperationCatalogs } from '../semantics/operation-catalogs.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { inputValue, type CatalogInput } from '../kernel/input-state.js';
import { DEFAULT_UX_LIMITS, type UxLimits } from '../model/ux/types.js';

/** UX 検証器に注入される共有サービス(ScreenContext と同じ流儀)。 */
export interface UxContext {
  /** `when` 条件が特定の状態と両立するかの判定に使う(U4 / U5)。 */
  readonly guards: GuardServices;
  /** 閾値(台帳から引いたもの)。省略は台帳が無い環境で、定数の既定値で動く。 */
  readonly limits?: UxLimits;
  /**
   * 操作の属性の導出が読むカタログ(U1 が確認の要否を、画面の生成と同じ導出で出すのに使う)。
   * 省略は「カタログがまだ無い」(cascade 由来の事実が見えないだけで、式は同じ)。
   */
  readonly catalogs?: OperationCatalogs;
  /**
   * action_spec の**入力の状態**(`ux:` の上書きと入力の事実を引く)。未選択は「action_spec は無い」事実。
   * **阻害のとき U1 は判定を出さない**(上書きを引けないまま確認の要否を決めると、確認が要らない操作を要ると言う / 個人データの入力を見落とす)。
   * 見ていないことは `verify/operation-input-notes.ts` が行で言う。任意の欄ではなく**必須**(省略を「action_spec は無い」と読ませると、
   * 阻害の構成の U1 が黙って回る。action_spec を読まない検査のテストは `UNSELECTED` を渡す)。
   */
  readonly actions: CatalogInput<ActionSpecModel>;
}

/**
 * action_spec が使えるときのモデル(未選択・阻害・省略は undefined)。
 *
 * @param ctx 検証器に注入された共有サービス
 */
export function actionsOf(ctx: UxContext): ActionSpecModel | undefined {
  return inputValue(ctx.actions);
}

/**
 * 検証器が使う閾値(台帳があれば台帳、無ければ既定値)。
 *
 * @param ctx 検証器に注入された共有サービス
 */
export function limitsOf(ctx: UxContext): UxLimits {
  return ctx.limits ?? DEFAULT_UX_LIMITS;
}
