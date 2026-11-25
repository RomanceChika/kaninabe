/**
 * 確認の器(重ね表示)の**生成の入力**(どの overlay が、どの部品のどの操作の確認ダイアログか)。
 *
 * 確認が要る操作(`confirm_required`。方針の導出)を載せた部品は、**その部品を `opened_by` に持ち、その操作を `actions` に
 * 含む重ね表示**を宣言する(S19 の (c))。生成物はその overlay の testid(`overlay.{id}.body.center` が器・
 * `overlay.{id}.body.center.confirm_bar` の `.confirm` / `.dismiss`)で `ConfirmDialog` を出す。フォームも表の行のボタンも
 * ボタン列も同じ導出を見る(確認の器の正を overlay の宣言 1 か所にする。部品の子の `confirm_bar` は無い)。
 *
 * この導出はアプリの語彙を 1 語も持たない(W1)。**決して throw しない** —— 重ね表示が無ければ undefined(検査が先に
 * 止める。無いまま生成すると確認なしで実行するフォームになるが、S19 が verify を赤にする)。
 */

import { canonicalActionId } from '../../semantics/action-ground.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import type { SpecModel } from '../../model/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { deriveActionAttributes } from './action-attributes-derive.js';

/** 確認の器の testid の骨格(`body.center` の `confirm_bar`。S19 が overlay の layout に要求する形)。 */
const CONFIRM_SLOT = 'body.center';
const CONFIRM_BAR = 'confirm_bar';

/** 確認の器の参照(`{画面名}TestIds` / `{画面名}Labels` のキー)。 */
export interface ConfirmOverlayRef {
  /** 重ね表示の id。 */
  readonly id: string;
  /** ダイアログの器の testid のキー(`overlay.{id}.body.center`)。 */
  readonly dialog: string;
  /** 中身(実行 / やめる)の testid のキー(`overlay.{id}.body.center.confirm_bar`)。 */
  readonly bar: string;
  /** 確認の見出し(`label`)を引く表示名の表のキー(`overlay.{id}`)。`label` が無ければ持たない。 */
  readonly labelKey?: string;
}

/**
 * 部品が載せる操作の確認の器(重ね表示)を引く。
 *
 * @param model ドメイン仕様(操作 ID の正規化に使う)
 * @param screen 対象の画面
 * @param component 操作を載せた部品の名前
 * @param operation 載せた操作の ID(書かれたままでも正式でもよい)
 * @returns その部品を `opened_by` に持ち、その操作を `actions` に含む重ね表示。無ければ undefined
 */
export function confirmOverlayOf(
  model: SpecModel,
  screen: ScreenSpec,
  component: string,
  operation: string,
): ConfirmOverlayRef | undefined {
  const canonical = (id: string): string => canonicalActionId(model, id) ?? id;
  const wanted = canonical(operation);
  const overlay = screen.overlays.find(
    (candidate) => candidate.openedBy === component && candidate.actions.some((action) => canonical(action.id) === wanted),
  );
  if (overlay === undefined) return undefined;
  const dialog = `overlay.${overlay.id}.${CONFIRM_SLOT}`;
  return {
    id: overlay.id,
    dialog,
    bar: `${dialog}.${CONFIRM_BAR}`,
    ...(overlay.label === undefined ? {} : { labelKey: `overlay.${overlay.id}` }),
  };
}

/**
 * 操作の確認の要否(`action-attributes.ts` の `confirmRequired` と同じ導出 — ハンドブック・ActionButton と共有)。
 * action_spec を読めていない操作は「確認なし」(生成物 `actionAttributesFor` の未知の操作の既定と同じ側)。
 */
export function confirmRequiredOf(model: SpecModel, ctx: GenerateContext, op: string): boolean {
  const action = ctx.actions?.actions.find((candidate) => candidate.handles.raw === op);
  return action !== undefined && deriveActionAttributes(model, ctx, action).confirmRequired;
}
