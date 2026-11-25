/**
 * テスト用の偽の認証基盤(`fetch` の差し替え)。ネットワークに出ずに、更新・利用者の取得・ログアウトの 3 つの口だけを答える。
 *
 * 受けた要求は `calls` に残る(どの口を、どの範囲で叩いたかをテストが確かめる)。
 */

import type { CookieWrite } from '../../cookie-policy';
import type { CookieJar, RequestCookie } from '../../session-client';

/** 偽の認証基盤の URL(どこにもつながらない)。 */
export const FAKE_AUTH_URL = 'http://auth.invalid';

/** 受けた要求 1 件。 */
export interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly search: string;
}

/** 偽の認証基盤の答え方。 */
export interface FakeAuthBehavior {
  /** ログアウトの口の応答のステータス(既定 204)。 */
  readonly logoutStatus?: number;
  /** 更新の口の失敗の答え(順に 1 回ずつ使い、尽きたら成功する)。 */
  readonly tokenFailures?: readonly (() => Response)[];
}

/** 偽の認証基盤。 */
export interface FakeAuthServer {
  readonly fetch: typeof fetch;
  readonly calls: FakeCall[];
}

/** 更新の口が返すセッション(新しいトークン)。 */
export function refreshedSessionBody(): Record<string, unknown> {
  return {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: fakeUser(),
  };
}

/** 利用者の取得の口が返す利用者。 */
export function fakeUser(): Record<string, unknown> {
  return { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-20T00:00:00Z' };
}

/**
 * 偽の認証基盤を作る。
 *
 * @param behavior - 答え方
 * @returns `fetch` と受けた要求の記録
 */
export function createFakeAuthServer(behavior: FakeAuthBehavior = {}): FakeAuthServer {
  const calls: FakeCall[] = [];
  const failures = [...(behavior.tokenFailures ?? [])];
  const respond = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    calls.push({ method, path: url.pathname, search: url.search });
    if (url.pathname === '/auth/v1/token') return Promise.resolve(failures.shift()?.() ?? Response.json(refreshedSessionBody()));
    if (url.pathname === '/auth/v1/user') return Promise.resolve(Response.json(fakeUser()));
    if (url.pathname === '/auth/v1/logout') return Promise.resolve(new Response(null, { status: behavior.logoutStatus ?? 204 }));
    return Promise.resolve(Response.json({ message: 'not found' }, { status: 404 }));
  };
  return { fetch: respond as typeof fetch, calls };
}

/**
 * `@supabase/ssr` が読む形のセッションの cookie の値(`base64-` + base64url(JSON))。
 *
 * @param expiresInSeconds - いまからの残り秒数(負なら期限切れ)
 * @param refreshToken - 更新トークンの欄の値(壊れた形を作るテストが差し替える)
 * @returns cookie の値
 */
export function sessionCookieValue(expiresInSeconds: number, refreshToken: unknown = 'old-refresh-token'): string {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: 'old-access-token',
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + expiresInSeconds,
    user: fakeUser(),
  };
  return `base64-${base64url(JSON.stringify(session))}`;
}

/** 文字列を UTF-8 の base64url にする(Node の Buffer に頼らない。このパッケージの型は Web 標準だけ)。 */
function base64url(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 記録する書き手(`CookieJar`)。 */
export interface RecordingJar extends CookieJar {
  readonly writes: CookieWrite[];
  readonly headers: Record<string, string>[];
}

/**
 * 要求の cookie を持ち、書き込みを記録する書き手を作る。
 *
 * @param cookies - 要求の cookie
 * @returns 書き手
 */
export function recordingJar(cookies: readonly RequestCookie[] = []): RecordingJar {
  const writes: CookieWrite[] = [];
  const headers: Record<string, string>[] = [];
  return {
    writes,
    headers,
    getAll: () => cookies,
    setAll: (written, cacheHeaders) => {
      writes.push(...written);
      headers.push({ ...cacheHeaders });
    },
  };
}
