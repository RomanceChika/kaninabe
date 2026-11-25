/**
 * 認証フロー仕様の `idp_session`(IdP とアプリのセッションの関係)の宣言の型と、語の言い方。
 *
 * 使い手は 2 つある: パーサー(`parse-auth-idp.ts`。H0 が形と「接地できる主張か」を見る)・文書の生成(宣言を認証の章に出す)。
 *
 * 「IdP のセッション」はサインインの方式の側(外部の認証プロバイダ。OAuth/OIDC の相手)が持つセッション、
 * 「アプリのセッション」はこのアプリが認証基盤(Supabase など)で持つセッションである。OAuth のコードの交換のあと、両者は別々に生き、別々に終わる。
 * その関係を 3 つの問いで宣言する: アプリのログアウトは IdP のセッションに何をするか・IdP のセッションが終わった / アカウントが失効したとき
 * アプリのセッションはどうなるか・寿命は IdP と揃えるか。
 *
 * **宣言できる主張はフレームワークが支えられるものだけである**。語の全体(`*_WORDS`)のうち `SUPPORTED_*` に入るものだけを H0 が通す
 * (残りは「書ける語だが、いまの仕組みは接地できない」として error)。OAuth の標準の口(認可コードの交換・セッションの cookie の削除)は
 * IdP のセッションを終える口を持たず、IdP の側の終了をアプリへ伝える口も持たない —— だから支えられるのは「IdP のセッションには触らない」
 * 「アプリのセッションはアプリの寿命で終わるまで続く」「寿命はアプリが決める」だけである。
 */

import type { SourceLocation } from '../types.js';

/** アプリのログアウトが IdP のセッションにすること。 */
export const IDP_LOGOUT_WORDS = ['keeps_idp', 'ends_idp'] as const;
/** IdP のセッションが終わった / アカウントが失効したとき、アプリのセッションがどうなるか。 */
export const IDP_ENDS_WORDS = ['app_continues', 'app_ends'] as const;
/** アプリのセッションの寿命の決め方。 */
export const IDP_LIFETIME_WORDS = ['independent', 'follows_idp'] as const;

export type IdpLogout = (typeof IDP_LOGOUT_WORDS)[number];
export type IdpEnds = (typeof IDP_ENDS_WORDS)[number];
export type IdpLifetime = (typeof IDP_LIFETIME_WORDS)[number];

/** いまの仕組みが支えられる語(H0 が通すのはこれだけ)。 */
export const SUPPORTED_IDP_LOGOUT: readonly IdpLogout[] = ['keeps_idp'];
export const SUPPORTED_IDP_ENDS: readonly IdpEnds[] = ['app_continues'];
export const SUPPORTED_IDP_LIFETIME: readonly IdpLifetime[] = ['independent'];

/**
 * IdP とアプリのセッションの関係の宣言(`idp_session`)。**必須**(書かなければ H0 が止める —— 書かないと、ログアウトしても IdP の
 * セッションは残ること・IdP の側の失効がアプリに届かないことを、誰も文書で知らないまま出荷される)。
 */
export interface AuthIdpSessionDecl {
  /** アプリのログアウトが IdP のセッションにすること。 */
  readonly logout: IdpLogout;
  /** IdP のセッションが終わった / アカウントが失効したとき、アプリのセッションがどうなるか。 */
  readonly idpEnds: IdpEnds;
  /** アプリのセッションの寿命の決め方。 */
  readonly lifetime: IdpLifetime;
  /** この関係でよい理由(空不可)。 */
  readonly reason: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 各語の言い方(文書に出す)。 */
export const IDP_WORDS: Readonly<Record<IdpLogout | IdpEnds | IdpLifetime, string>> = {
  keeps_idp: 'アプリのログアウトは IdP のセッションを終えない(この端末のアプリのセッションだけを閉じる)',
  ends_idp: 'アプリのログアウトは IdP のセッションも終える',
  app_continues: 'IdP のセッションが終わっても、IdP のアカウントが失効しても、アプリのセッションはアプリの寿命(sessions)が来るまで続く',
  app_ends: 'IdP のセッションが終わる / アカウントが失効すると、アプリのセッションも終える',
  independent: 'アプリのセッションの寿命はアプリが決める(sessions)。IdP のセッションの寿命とは揃えない',
  follows_idp: 'アプリのセッションの寿命は IdP のセッションに従う',
};
