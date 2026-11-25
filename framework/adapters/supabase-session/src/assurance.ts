/**
 * **セッションが多要素認証を済ませているか**の読み取り(認証フロー仕様の `mfa` の、Supabase での当てはめ)。
 *
 * 仕様: docs/rules/process/backend/specification/standards/auth-spec-writing.md §mfa
 *
 * 多要素認証の正は認証基盤のセッションの保証の水準である —— Supabase では、要素(TOTP・電話・WebAuthn)を確かめた
 * セッションのアクセストークンの `aal` が `aal2` になる。実行時パッケージは真偽だけを受ける(`RunPlanCommand.actorMfa`)ので、
 * どの値がそれに当たるかはここが 1 か所で決める。
 *
 * **読むのは署名を確かめたクレームだけである**(`auth.getClaims()`。非対称の署名鍵なら公開鍵で手元で確かめ、対称の鍵なら
 * 認証基盤に問い合わせて確かめる)。`getSession()` の値は cookie から読んだだけで確かめていないので使わない —— 要求を
 * 外せる値を、利用者の手の届く cookie から信じることになる。確かめられなかったとき(未ログイン・期限切れ・署名の不一致・
 * 問い合わせの失敗)は**済ませていない**と答える(安全側)。
 *
 * **署名の確かめだけでは足りない(ASVS V7.4.1)。** 非対称の署名鍵ではクレームの検証が手元で終わり、セッションが終わった
 * (ログアウト・無効化・全端末の終了)あとも、アクセストークンの期限(既定 1 時間)まで署名は有効なままである。
 * なので `aal2` を信じる前に、**認証基盤への問い合わせ(`getUser`。サーバーがセッションの存在を確かめる)**も通す —
 * セッションの行が消えていれば、署名が有効でも「済ませていない」と答える。
 */

/** 多要素認証を済ませたセッションの保証の水準(Supabase のアクセストークンの `aal`)。 */
export const MFA_ASSURANCE_LEVEL = 'aal2';

/** 署名を確かめたクレームを返す口(Supabase のクライアントの `auth.getClaims` の形のうち、ここが読む部分)。 */
export interface ClaimsReader {
  readonly auth: {
    getClaims(): Promise<{ readonly data: { readonly claims: { readonly aal?: unknown } } | null; readonly error: unknown }>;
    /** 認証基盤に問い合わせて、セッションが生きているかを確かめる(署名が有効でも、終わったセッションはここで落ちる)。 */
    getUser(): Promise<{ readonly data: { readonly user: unknown } | null; readonly error: unknown }>;
  };
}

/**
 * リクエストのセッションが多要素認証を済ませているか。
 *
 * @param client - リクエストのセッションを載せたクライアント(`createSessionClient` が作るもの)
 * @returns 署名を確かめたクレームの `aal` が `aal2` なら true。確かめられなければ false
 */
export async function sessionMfaVerified(client: ClaimsReader): Promise<boolean> {
  const { data, error } = await client.auth.getClaims();
  if (error !== null || data === null || data.claims.aal !== MFA_ASSURANCE_LEVEL) return false;
  const alive = await client.auth.getUser();
  return alive.error === null && alive.data?.user !== null && alive.data?.user !== undefined;
}
