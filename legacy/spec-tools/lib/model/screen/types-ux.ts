/**
 * 画面ごとの UX 原則の受け入れ(`ux:`)の型。
 *
 * 型の本体(`types.ts`)から分けてあるのは、UX 原則の台帳と検査(U 群)の語彙が増えるたびに変わる場所で、
 * 画面仕様の構造の型とは変更の理由が違うためである(`types.ts` は `./types-ux.js` から再輸出する)。
 */

import type { SourceLocation } from '../types.js';

/**
 * 画面ごとの UX 原則の受け入れ 1 件(`ux:`)。
 *
 * 画面側の口は**受け入れだけ**で、事実の欄は開けない(画面が方針を再定義する口にしないため)。
 * action_spec の `ux: { confirm, reason }`(導出の上書き)と同じ「UX 原則への態度」の口だが、形は別である。
 * 突合の鍵は(この画面・原則の ID・subject)で、画面は自明なので subject は `screen-{name}/` の接頭辞を除いた部分を書く。
 */
export interface ScreenUxAccept {
  /** 受け入れる原則の ID(台帳の `enforced_by` と同じ検査 ID。例: `U4`)。 */
  readonly principle: string;
  /** 指摘の対象(接頭辞を除いた subject。画面そのものへの指摘なら空文字)。 */
  readonly subject: string;
  /** その UX でよいと判断した理由(日本語。空は S0)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}
