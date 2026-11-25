/**
 * **Supabase のセッションをサーバーだけが持つ adapter**(`@kaninabe/adapter-supabase-session`)の公開の入口。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」(案 A)
 *
 * ブラウザの Supabase クライアントを使わない形の部品を持つ —— cookie の約束(`__Host-`・`HttpOnly`・`Secure`・`SameSite=Lax`)・
 * サーバーのクライアントの作り方・リクエスト前段の更新・サインインの開始の口・ログアウトの口。Next.js には依らず、
 * cookie の読み書きは小さな口(`CookieJar`)で、口の要求と応答は Web 標準の `Request` / `Response` で受け渡す
 * (Next.js とのつなぎは製品の土台に薄く残る)。
 *
 * **サーバー専用の印(`import 'server-only'`)はここに置かない**(`@kaninabe/adapter-postgrest` と同じ)。印は製品の配線が持ち、
 * クライアントの部品からの混入は製品の lint の層境界が止める。
 */

export {
  AUTH_COOKIE_ATTRIBUTES,
  HOST_PREFIX,
  SESSION_COOKIE_NAME,
  VERIFIER_MAX_AGE_SECONDS,
  assertCarrySpec,
  carriedValue,
  cookieWrite,
  expiredCookie,
  hardenedOptions,
  isLegacySessionCookieName,
  isSessionCookieName,
} from './cookie-policy';
export type { AuthCookieOptions, CarryCookieSpec, CookieWrite, LifetimeOptions } from './cookie-policy';
export { MFA_ASSURANCE_LEVEL, sessionMfaVerified } from './assurance';
export type { ClaimsReader } from './assurance';
export { SessionUnreadableError, createSessionClient, legacyCookieRemovals, refreshSession, signedInUserOf } from './session-client';
export type { AuthEndpoint, AuthOnlyDatabase, CookieJar, RequestCookie, SessionClient, SessionClientOptions, UserReadResult } from './session-client';
export { REFRESH_SPENT_HEADER, createRefreshBudget } from './refresh-guard';
export type { RefreshBudget } from './refresh-guard';
export { JWT_LIFETIME_FLOOR_SECONDS } from './refresh-share';
export { createSessionScope } from './session-scope';
export type { SessionScope, SessionScopeOptions, SessionStage } from './session-scope';
export { startOutcome, startSignIn } from './sign-in';
export type { OAuthStartResult, SignInStartConfig, StartOutcome } from './sign-in';
export { SESSION_RPC_NAMES, SessionAdminError, createSessionAdmin, currentSessionIdOf } from './session-admin';
export type { SessionAdmin, SessionIdReader, SessionRpcNames, SessionSummary } from './session-admin';
export { CLEAR_SITE_DATA, signOut } from './sign-out';
export type { SignOutConfig } from './sign-out';
// 生の転送の部品 `redirectResponse` は公開しない(例外の住所の部品は、検査しない転送を配らない。点検 10 回目 B10-2)。
export { NO_STORE, authRedirectOrigins, refusalResponse, requestCookies, setCookieValue } from './http-response';
