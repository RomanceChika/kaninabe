/**
 * 認証フロー仕様の `mfa`(多要素認証の要求)の宣言の型。
 *
 * 使い手は 5 つある: パーサー(`parse-auth-mfa.ts`。H0 が形を見る)・H6(要求の送り先・外す宣言・書き込みの入口の解決の実在)・
 * プラットフォームの後段の H5(要求するなら設定で要素を有効にしているか)・文書の生成(宣言を表に出す)・実装の生成
 * (書き込みの入口の執行。実行時の束の `mfa` と、Server Action がセッションの状態を実行器へ渡す 1 行)。
 *
 * **多要素認証の正は認証基盤のセッションの保証の水準**(Supabase なら JWT の `aal` が `aal2`)である。サインインの方式(外部の IdP・
 * メール)ごとの「アカウントで有効にしているか」は、そのログインで要素を使った証拠にならないので正にしない。
 * 語は中立である(「多要素認証を済ませたセッション」)。どの値がそれに当たるかは後段と実装が決める。
 */

import type { SourceLocation } from '../types.js';

/** 誰に要求するか(`all` = サインインした全員 / `roles` = 宣言したロールを持つ人だけ)。 */
export type MfaScope = { readonly kind: 'all' } | { readonly kind: 'roles'; readonly roles: readonly string[] };

/**
 * 多要素認証の宣言(`mfa`)。**必須**で、書かなければ H0 が止める(既定は全員に要求する。要求するなら送り先が要るので、
 * 黙って外れる形にも、送り先の無い要求にもしない)。
 *
 * - `require` … 要求する。多要素認証を済ませていないセッションの人を `to` の画面(要素の登録・確認)へ送る。
 *   入場のたびに確かめるのは `implementation` の関数(関門と同じく、画面の実装が呼ぶ)
 * - `exempt` … 外す。理由が必須で、verify が毎回「受け入れた危険」の警告で名指す(H6)
 * - `delegated` … IdP に任せる(アプリ自前の 2 つ目の要素を持たない)。**外部の IdP でログインする製品の既定**。
 *   本番の方式(`providers`)が任せる IdP 1 つだけの製品に限る(ほかの方式で入る人には要素が掛からないので、H6 が error にする)。
 *   根拠(`evidence`)が `none` の間は、IdP の多要素認証が今回のログインで使われたかを確かめられないので、`exempt` と同じく
 *   verify が毎回「受け入れた危険」で名指す(H6)。根拠を確かめられる形(組織のドメインに限る・ID トークンの `amr`)は
 *   Supabase 経由で値が署名つきでアプリに届くと確かめられるまで受け付けない(`parse-auth-mfa.ts` が理由つきで止める)
 */
export type AuthMfaDecl =
  | {
      readonly kind: 'require';
      readonly scope: MfaScope;
      /** 多要素認証を済ませていない人を送る画面(screen_spec の id)。 */
      readonly to: string;
      /** 入場のたびに多要素認証を確かめる関数(`パス::関数名`)。 */
      readonly implementation: string;
      /** どういう要求かを 1 行で。 */
      readonly summary: string;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: 'exempt';
      /** 外す理由(空でない)。 */
      readonly reason: string;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: 'delegated';
      /** 任せる IdP(`providers` に実在する外部の IdP で、本番の方式はこれ 1 つだけ。H6 が見る)。 */
      readonly provider: string;
      /** 任せる根拠。いまは `none`(根拠なしで任せる)だけ。 */
      readonly evidence: MfaDelegationEvidence;
      /** 任せる理由(空でない)。 */
      readonly reason: string;
      readonly location: SourceLocation;
    };

/** 「IdP に任せる」の根拠の種類(受け付けるもの)。 */
export type MfaDelegationEvidence = 'none';

/**
 * 根拠の種類のうち**まだ受け付けないもの**と、その理由(書かれたら parse が理由つきで止める。黙って保証扱いにしない)。
 *
 * どちらも「サインインの帰り道で、署名つきの ID トークンの値を検証する実装」が要る。Supabase Auth は IdP の ID トークンを
 * アプリへ渡さず(アプリが受け取るのは Supabase 自身が署名した JWT)、`amr` は転送されない。Google の `hd` は
 * 認証基盤の identities 表の `identity_data.custom_claims` に入るが、JWT には載らず、ユーザーが書き換えられる `user_metadata` にも
 * 写る。サーバー側(サービスロール)で identities 表を読み直して照合する帰り道の実装と、実在の IdP での実測が要るため、
 * 確かめられるまで受け付けない。
 */
export const UNSUPPORTED_DELEGATION_EVIDENCE: Readonly<Record<string, string>> = {
  workspace_domain:
    '組織のドメインに限る根拠(workspace_domain)は未対応です。Supabase Auth は IdP の ID トークンの hd を JWT に載せず、アプリへ署名つきで渡さないため、帰り道で署名済みの値を検証できません',
  amr: 'ID トークンの amr を根拠にする形(amr)は未対応です。Supabase Auth は IdP の amr をアプリへ渡しません(JWT の amr は Supabase 自身の認証方法の記録で、IdP の多要素認証の記録ではない)',
};

/** サインインの方式(`providers` の語)のうち、外部の IdP ではないもの(IdP に任せられない)。 */
export const NON_IDP_SIGN_IN_METHODS: ReadonlySet<string> = new Set(['email', 'phone']);

/** 要求の範囲を人が読む言い方にする(`サインインした全員` / `ロール {ID}・{ID}`)。 */
export function mfaScopeWords(scope: MfaScope): string {
  return scope.kind === 'all' ? 'サインインした全員' : `ロール ${scope.roles.join('・')}`;
}

/**
 * セッションが多要素認証を済ませたかを解決する関数の名前(製品の認証の組み立ての根が export する手書きの接続点)。
 *
 * 要求する製品の生成された Server Action がこれを import して実行器へ渡し(`generate/render/mfa-entry.ts`)、H6 が実在を
 * 構文木で確かめる。名前の正はここ 1 か所である。
 */
export const MFA_RESOLVER = 'resolveSessionMfa';

/** 多要素認証の判定の部品のモジュール指定(実行時パッケージの公開の口。実行器と同じ判定)。 */
export const MFA_GUARD_MODULE = '@kaninabe/runtime/template/mfa';

/**
 * 手書きの入口(`runner: manual` の Server Action)が判断と書き込みの前に呼ぶ判定の名前。`refuseUnverifiedMfa` が手書き向けの口で、
 * `mfaRefusal` は実行器が引く芯そのもの(どちらも同じ判定)。H6 が構文木で呼び出しを確かめる。
 */
export const MFA_GUARD_FUNCTIONS: readonly string[] = ['refuseUnverifiedMfa', 'mfaRefusal'];

/**
 * 書き込みの入口で執行する要求の範囲(要求の宣言があるときだけ。外す宣言・宣言が無い・読めないときは `null`)。
 *
 * 生成器(実行時の束・Server Action の実行者の解決・生成テスト)が同じ 1 つの判定を引く —— 束にだけ要求が載って
 * Server Action が済ませたかどうかを渡さない(全員が拒否される)、またはその逆(要求が黙って外れる)の食い違いを作らない。
 *
 * @param mfa 認証フロー仕様の `mfa`(読めなければ undefined)
 * @returns 要求の範囲、または null
 */
export function enforcedMfaScope(mfa: AuthMfaDecl | undefined): MfaScope | null {
  return mfa?.kind === 'require' ? mfa.scope : null;
}
