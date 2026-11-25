/**
 * 画面が発火すると宣言した操作(前段。画面の宣言から読むだけの射影)。
 *
 * 検証器(S 群・U 群)・生成器・ハンドブックが同じ母集合を読むための 1 か所。画面の宣言の型だけを読み、
 * ドメイン仕様への接地は読まない(接地は `lib/semantics/action-ground.ts`)。UX 経験則(`lib/ux/`)が
 * 画面の検証の置き場(`lib/screen/`)を読まずに済むよう、前段に置く(設計メモ framework-modules §13)。
 */

import type { ScreenRef, ScreenSpec } from './types.js';

/**
 * その画面が発火すると宣言した操作(画面の `actions` + 重ね表示の `actions`)。
 *
 * **どこに置かれたボタンでも、発火するのはその画面である。** この和が S2(接地と `on` の
 * 母集合)・S4(実行ロールの交差)・S10(UI 到達の網羅)・生成物(`screens.ts` の `actions`)・
 * 画面一覧表のすべてで同じ母集合であることが、Phase C-6 第 2 波の決定(V9)の中身である。
 * 同じ畳み方を各所に書き写すと、片方だけが古い定義のまま残る。
 *
 * 重複(画面と重ね表示の両方に同じ操作を書いた場合)はここでは畳まない — 位置情報つきの
 * 指摘を出す側は各要素を個別に見たいためである。ID の集合が要る呼び出し側は
 * `declaredActionIds` を使う。
 *
 * @param screen 対象の画面
 * @returns 宣言された操作の参照(画面 → 重ね表示の宣言順)
 */
export function declaredActionRefs(screen: ScreenSpec): readonly ScreenRef[] {
  return [...screen.actions, ...screen.overlays.flatMap((overlay) => overlay.actions)];
}

/**
 * その画面が発火すると宣言した操作の ID 集合(重複を畳んだもの)。
 *
 * @param screen 対象の画面
 * @returns 宣言された操作の ID(宣言順・重複なし)
 */
export function declaredActionIds(screen: ScreenSpec): readonly string[] {
  return [...new Set(declaredActionRefs(screen).map((action) => action.id))];
}

/**
 * その画面が露出すると宣言したプラットフォーム操作(画面の `platform_ops` + 重ね表示の `platform_ops`)。
 *
 * `declaredActionRefs` の兄弟で、**ドメインイベントでない認証基盤の操作**の母集合である(別の口なので `actions` の母集合には混ぜない —
 * S2・S4・S10・生成物がその和を読む。ADR-0019)。S20(実在・ロール整合・確認の器)と S21(網羅)が同じ母集合を読む。
 * 重複は畳まない(位置つきの指摘を出す側は各要素を個別に見たい)。
 *
 * @param screen 対象の画面
 * @returns 宣言されたプラットフォーム操作の参照(画面 → 重ね表示の宣言順)
 */
export function declaredPlatformOpRefs(screen: ScreenSpec): readonly ScreenRef[] {
  return [...screen.platformOps, ...screen.overlays.flatMap((overlay) => overlay.platformOps)];
}
