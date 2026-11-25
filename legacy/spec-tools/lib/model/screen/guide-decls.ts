/**
 * specs/frontend/screens/README.md のフロントマターに書く**免除の宣言**の型。
 *
 * 画面仕様そのものではなく「この検査をここでは受け入れる」という判断の記録であり、
 * 1 画面 1 ファイルの screen_spec とは置き場も寿命も違う(画面ができれば消える宣言である)。
 * 入口は types.ts(ファサード)。読み取りは lib/model/decl-list.ts が
 * A4 の `unhandled` と同じ規則で行う。
 */

import type { SourceLocation } from '../types.js';

/**
 * どの画面からも発火されないドメイン操作の理由宣言(S10 の免除)。
 * フロントマターの `unexposed` に書く。
 *
 * A4 の `unhandled`(specs/backend/actions/README.md)と同じ流儀である。「まだ画面を作らない」
 * という判断自体は正当であり、禁じたいのは**理由のないまま操作が UI から消えていること**である。
 */
export interface ExposureDecl {
  /** `{machine}.{event}` または予約 ID(`{entity}.create` / `.delete` / `.update`)。 */
  readonly event: string;
  /** その操作を画面から発火できるようにしていない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * (遷移, 状態, ロール)の組が、どの画面からも到達できないことの理由宣言(S13 の免除)。
 * フロントマターの `unreachable_states` に書く。
 *
 * `unexposed`(S10)と同じ流儀 —「その状態でその人がその操作を起こせる画面がまだ無い」という
 * 判断自体は正当であり、禁じたいのは**理由のないまま到達経路が欠けていること**である。
 * 3 つの軸(遷移・状態・ロール)を組にしないと突合の鍵が一意にならない
 * (同じ遷移でも状態ごと・ロールごとに到達の有無が変わるため)。
 */
export interface RoleStateReachDecl {
  /** `{machine}.{event}` 形式のドメインイベント ID。 */
  readonly transition: string;
  /** 遷移元の状態 ID(`from` の 1 つ)。 */
  readonly state: string;
  /** 実行できるはずなのに到達できない人間ロール ID。 */
  readonly role: string;
  /** その状態・そのロールから到達する画面をまだ作っていない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * ある状態の実体を、人間が読み取り経路から見られないことの理由宣言(S14 の免除)。
 * フロントマターの `unseen_states` に書く。
 *
 * S14 は warning であり(V6 のデッドエンドと違い「その状態を見せる画面が無い」ことが
 * 直ちに壊れているとは限らない — 例えば内部的な一瞬の中間状態)、それでも
 * 「見せない」という判断を理由なく残さないための器を同じ流儀で用意する。
 */
export interface StateVisibilityDecl {
  /** `{machine}.{state}` 形式(state_spec の状態 ID)。 */
  readonly state: string;
  /** その状態を人間の読み取り経路から見せていない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * どの画面にも露出しないプラットフォーム操作の理由宣言(S21 の免除)。
 * フロントマターの `unexposed_platform_ops` に書く。
 *
 * `unexposed`(S10)と同じ流儀 —「まだ画面を作らない」という判断自体は正当であり、禁じたいのは
 * **理由のないまま認証基盤の操作が UI から消えていること**である。
 */
export interface PlatformOpExposureDecl {
  /** auth_spec の `platform_ops` の操作 id。 */
  readonly op: string;
  /** その操作を画面に出していない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}
