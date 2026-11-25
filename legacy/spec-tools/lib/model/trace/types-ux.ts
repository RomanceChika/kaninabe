/**
 * action_spec の `ux:`(方針の導出の上書き)の型。
 *
 * 入口は types.ts(そこから再 export される)。`ux:` という 1 つの宣言の型である。
 * 正: action-spec-writing.md「方針の導出」。
 */

import type { SourceLocation } from '../types.js';

/** `ux.confirm` の値域。 */
export const ACTION_UX_CONFIRM_VALUES = ['none', 'required'] as const;

/** `ux.confirm` の値。 */
export type ActionUxConfirm = (typeof ACTION_UX_CONFIRM_VALUES)[number];

/**
 * action_spec の `ux:` — 方針の導出(action-spec-writing.md「方針の導出」)の**上書き**。
 *
 * 導出規則(`confirm_required` = negative への遷移 ∨ destructive ∨ (irreversible ∧
 * affects_others) ∨ settles)が現実と食い違う場合だけ書く。`reason` は必須(V14)——
 * 理由の無い上書きは「なんとなく消した」と区別が付かない。
 */
export interface ActionUxOverride {
  /** `none` = 導出が要求しても確認を出さない。`required` = 導出が不要でも確認を出す。 */
  readonly confirm: ActionUxConfirm;
  /** 上書きの理由(日本語 1 文)。省略は V14 がエラーにする。 */
  readonly reason?: string;
  readonly location: SourceLocation;
}
