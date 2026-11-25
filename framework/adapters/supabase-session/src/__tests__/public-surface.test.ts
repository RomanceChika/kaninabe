/**
 * **セッションの adapter の公開の口の閉じた表**(fix27 項目 C。差分点検 fix26 14 回目 E14-1。照らしの本体は `@kaninabe/adapter-postgrest/testing/closed-surface`)。
 *
 * `package.json` の `exports` の全部の入口の、全部の口(値と型)を 1 行ずつ載せる。口を足したのに表に無い・表にあるのに口が無い・
 * 口が生の道(やり直しの口を通らない `rpc`・`schema`・`from` の書き込み)を返す / 受け取る・照らしの深さの上限で読み切れない ——
 * のどれも赤になる。生の `SupabaseClient` を返す口(E14-1 の最小の反例)の負例は、枠の保証の見張り TC-FW-CONNPATH-002 が持つ。
 *
 * 認証基盤のクライアント(`auth`。管理 API の `auth.admin` を含む)は上限の中で底まで読めて、生の道に届かない。ただし口が渡す `any` は
 * どの段でも読み切れない(fix27 差分点検 C27-2)ので、利用者・ID の情報の metadata の袋(`{ [key: string]: any }`)は宣言の行
 * {@link UnreadDeclarations} で、Edge Functions の呼び出しの `error: any` は住所の行で受ける。auth のほかの所は行無しで底まで読み切る。
 * 読み切れない住所は下の {@link UnreadAddresses} と {@link UnreadDeclarations} に理由つきで載せたものだけである。
 */

import { describe, expect, it } from 'vitest';
import { ownSurfaceProblems } from '@kaninabe/adapter-postgrest/testing/closed-surface';
import type * as Root from '../index';
import type * as CookiePolicy from '../cookie-policy';

/** 型の口を呼ぶ DB の型(表を 1 枚持つ)。 */
type Db = {
  readonly api: {
    readonly Tables: { readonly widgets: { readonly Row: { readonly id: string }; readonly Insert: { readonly id?: string }; readonly Update: { readonly id?: string }; readonly Relationships: [] } };
    readonly Views: Record<never, never>;
    readonly Functions: Record<never, never>;
  };
};

/** 入口 → 口の名前 → 口の型。 */
export interface PublicSurface {
  '.': {
    AUTH_COOKIE_ATTRIBUTES: typeof Root.AUTH_COOKIE_ATTRIBUTES;
    HOST_PREFIX: typeof Root.HOST_PREFIX;
    SESSION_COOKIE_NAME: typeof Root.SESSION_COOKIE_NAME;
    VERIFIER_MAX_AGE_SECONDS: typeof Root.VERIFIER_MAX_AGE_SECONDS;
    assertCarrySpec: typeof Root.assertCarrySpec;
    carriedValue: typeof Root.carriedValue;
    cookieWrite: typeof Root.cookieWrite;
    expiredCookie: typeof Root.expiredCookie;
    hardenedOptions: typeof Root.hardenedOptions;
    isLegacySessionCookieName: typeof Root.isLegacySessionCookieName;
    isSessionCookieName: typeof Root.isSessionCookieName;
    AuthCookieOptions: Root.AuthCookieOptions;
    CarryCookieSpec: Root.CarryCookieSpec;
    CookieWrite: Root.CookieWrite;
    LifetimeOptions: Root.LifetimeOptions;
    MFA_ASSURANCE_LEVEL: typeof Root.MFA_ASSURANCE_LEVEL;
    sessionMfaVerified: typeof Root.sessionMfaVerified;
    ClaimsReader: Root.ClaimsReader;
    SessionUnreadableError: typeof Root.SessionUnreadableError;
    createSessionClient: typeof Root.createSessionClient<Db, 'api'>;
    legacyCookieRemovals: typeof Root.legacyCookieRemovals;
    refreshSession: typeof Root.refreshSession;
    signedInUserOf: typeof Root.signedInUserOf;
    AuthEndpoint: Root.AuthEndpoint;
    AuthOnlyDatabase: Root.AuthOnlyDatabase;
    CookieJar: Root.CookieJar;
    RequestCookie: Root.RequestCookie;
    SessionClient: Root.SessionClient<Db, 'api'>;
    SessionClientOptions: Root.SessionClientOptions<'api'>;
    UserReadResult: Root.UserReadResult<{ readonly id: string }>;
    REFRESH_SPENT_HEADER: typeof Root.REFRESH_SPENT_HEADER;
    createRefreshBudget: typeof Root.createRefreshBudget;
    RefreshBudget: Root.RefreshBudget;
    JWT_LIFETIME_FLOOR_SECONDS: typeof Root.JWT_LIFETIME_FLOOR_SECONDS;
    createSessionScope: typeof Root.createSessionScope;
    SessionScope: Root.SessionScope;
    SessionScopeOptions: Root.SessionScopeOptions;
    SessionStage: Root.SessionStage;
    startOutcome: typeof Root.startOutcome;
    startSignIn: typeof Root.startSignIn;
    OAuthStartResult: Root.OAuthStartResult;
    SignInStartConfig: Root.SignInStartConfig;
    StartOutcome: Root.StartOutcome;
    SESSION_RPC_NAMES: typeof Root.SESSION_RPC_NAMES;
    SessionAdminError: typeof Root.SessionAdminError;
    createSessionAdmin: typeof Root.createSessionAdmin;
    currentSessionIdOf: typeof Root.currentSessionIdOf;
    SessionAdmin: Root.SessionAdmin;
    SessionIdReader: Root.SessionIdReader;
    SessionRpcNames: Root.SessionRpcNames;
    SessionSummary: Root.SessionSummary;
    CLEAR_SITE_DATA: typeof Root.CLEAR_SITE_DATA;
    signOut: typeof Root.signOut;
    SignOutConfig: Root.SignOutConfig;
    NO_STORE: typeof Root.NO_STORE;
    authRedirectOrigins: typeof Root.authRedirectOrigins;
    refusalResponse: typeof Root.refusalResponse;
    requestCookies: typeof Root.requestCookies;
    setCookieValue: typeof Root.setCookieValue;
  };
  './cookie-policy': {
    AUTH_COOKIE_ATTRIBUTES: typeof CookiePolicy.AUTH_COOKIE_ATTRIBUTES;
    HOST_PREFIX: typeof CookiePolicy.HOST_PREFIX;
    SESSION_COOKIE_NAME: typeof CookiePolicy.SESSION_COOKIE_NAME;
    VERIFIER_MAX_AGE_SECONDS: typeof CookiePolicy.VERIFIER_MAX_AGE_SECONDS;
    assertCarrySpec: typeof CookiePolicy.assertCarrySpec;
    carriedValue: typeof CookiePolicy.carriedValue;
    cookieWrite: typeof CookiePolicy.cookieWrite;
    expiredCookie: typeof CookiePolicy.expiredCookie;
    hardenedOptions: typeof CookiePolicy.hardenedOptions;
    isLegacySessionCookieName: typeof CookiePolicy.isLegacySessionCookieName;
    isSessionCookieName: typeof CookiePolicy.isSessionCookieName;
    AuthCookieOptions: CookiePolicy.AuthCookieOptions;
    CarryCookieSpec: CookiePolicy.CarryCookieSpec;
    CookieWrite: CookiePolicy.CookieWrite;
    LifetimeOptions: CookiePolicy.LifetimeOptions;
  };
}

/**
 * 入口 → 照らしの深さの上限で読み切れない住所 → 読まなくてよい理由(照らしは行の奥でも生の道を名指す。受けるのは「読み切れない」だけ)。
 * `createSessionClient()` の戻りと型の口 `SessionClient` は同じ接続層の形なので、同じ住所を両方に載せる。
 */
export interface UnreadAddresses {
  '.': {
    'createSessionClient().from().select()': '読み取りの組み立て(PostgrestFilterBuilder)は絞り込みのたびに型引数が育つ再帰の型で底に着かない。書き換えのメソッドは ReadOnlyClient が from() の戻りから外してあり(Pick の select だけ)、select() の先は絞り込みと変形だけ';
    'createSessionClient().realtime': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'createSessionClient().channel': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'createSessionClient().getChannels': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'createSessionClient().removeChannel': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'createSessionClient().functions.invoke().error': 'Edge Functions の SDK の invoke() の戻りの error が any(関数の HTTP の失敗の本文)で読み切れない。PostgREST の RPC・表の書き込みの道ではない';
    'createSessionClient().storage': 'Storage(ファイルの HTTP API)の SDK の部分。from(バケツ) が返すファイルの口は select を持たず(規則の表の書き込みではない)、アップロードの本文の型が上限より深い';
    'SessionClient.from().select()': '読み取りの組み立て(PostgrestFilterBuilder)は絞り込みのたびに型引数が育つ再帰の型で底に着かない。書き換えのメソッドは ReadOnlyClient が from() の戻りから外してあり(Pick の select だけ)、select() の先は絞り込みと変形だけ';
    'SessionClient.realtime': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'SessionClient.channel': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'SessionClient.getChannels': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'SessionClient.removeChannel': 'Realtime(WebSocket の購読)の SDK の部分。チャンネルとソケットが互いを指す再帰の型で、何段読んでも底に着かない。PostgREST の RPC・表の書き込みの道ではない';
    'SessionClient.functions.invoke().error': 'Edge Functions の SDK の invoke() の戻りの error が any(関数の HTTP の失敗の本文)で読み切れない。PostgREST の RPC・表の書き込みの道ではない';
    'SessionClient.storage': 'Storage(ファイルの HTTP API)の SDK の部分。from(バケツ) が返すファイルの口は select を持たず(規則の表の書き込みではない)、アップロードの本文の型が上限より深い';
  };
}

/**
 * 宣言(置き場#名前)→ 読まなくてよい理由。その宣言の中に書かれた欄・添字の奥の「読み切れない」(渡す any を含む)だけを受ける
 * (照らしは行の中でも生の道を名指す。auth のほかの所は行無しで底まで読み切る)。同じ型が認証の全部の戻りに出るので、住所ではなく宣言で受ける。
 */
export interface UnreadDeclarations {
  '@supabase/auth-js/dist/module/lib/types.d.ts#UserMetadata': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
  '@supabase/auth-js/dist/module/lib/types.d.ts#UserAppMetadata': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
  '@supabase/auth-js/dist/module/lib/types.d.ts#UserIdentity': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
  '@supabase/auth-js/dist/module/lib/types.d.ts#JwtPayload': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
  '@supabase/auth-js/dist/module/lib/types.d.ts#Pagination': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
  '@supabase/auth-js/dist/module/lib/types.d.ts#CustomOAuthProvider': '認証基盤の SDK の利用者・ID の情報の袋 { [key: string]: any }(認証サーバーが返す JSON)。口が渡す any として読み切れない。この宣言の奥の生の道(rpc・schema・書き込み)は行の中でも名指す';
}

describe('セッションの adapter の公開の口は閉じている', () => {
  it('exports の全部の口が表に載り、どの口も生の道を返さず受け取らず、上限の中で読み切れる(表の行の住所を除く)。セッションの接続層から rpc・schema・書き込みを書けない', () => {
    expect(ownSurfaceProblems(import.meta.url)).toEqual([]);
  });
});
