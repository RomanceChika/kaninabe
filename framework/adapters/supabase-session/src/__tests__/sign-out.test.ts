import { describe, expect, it } from 'vitest';
import { CLEAR_SITE_DATA, signOut } from '../sign-out';
import type { SignOutConfig } from '../sign-out';
import { FAKE_AUTH_URL, createFakeAuthServer, sessionCookieValue } from './fakes/auth-server';

/** ログアウトの口(`sign-out.ts`)。 */

/** 同じオリジンのページからのフォーム送信(cookie つき)。 */
function post(cookie: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/api/auth/logout', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', cookie, ...headers },
  });
}

/** Set-Cookie を名前ごとに引く。 */
function setCookies(response: Response): Map<string, string> {
  return new Map(response.headers.getSetCookie().map((value) => [value.split('=')[0] ?? '', value]));
}

describe('ログアウトの口', () => {
  // 点検 10 回目 B10-2 の探り: 着地を利用者の値(`?next=`)から作っても、外へは出ない(書いた人の誤りとして口が例外になる)。
  it.each([['https://evil.example/login'], ['//evil.example'], ['/\\evil.example'], ['/.//evil.example'], ['login'], ['']])('着地 %s が同じオリジンの相対パスでなければ、口は例外(cookie も消さず、外へ倒さない)', async (landingPath) => {
    const server = createFakeAuthServer();
    await expect(signOut(post(`__Host-auth=${sessionCookieValue(3000)}`), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath })).rejects.toThrow(/landingPath は同じオリジンの相対パス/u);
    expect(server.calls).toEqual([]);
  });

  it('この端末のセッションだけを閉じ(scope=local)、認証の cookie を全部消して、Clear-Site-Data つきで着地へ 303', async () => {
    const server = createFakeAuthServer();
    const config: SignOutConfig = { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login', alsoExpire: ['__Host-carry'] };
    const cookie = [
      `__Host-auth=${sessionCookieValue(3000)}`,
      '__Host-auth-code-verifier=v',
      'sb-127-auth-token=legacy',
      'unrelated=x',
    ].join('; ');
    const response = await signOut(post(cookie), config);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('clear-site-data')).toBe(CLEAR_SITE_DATA);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const logout = server.calls.find((call) => call.path === '/auth/v1/logout');
    expect(logout?.search).toBe('?scope=local');
    const cookies = setCookies(response);
    expect([...cookies.keys()].sort()).toEqual(['__Host-auth', '__Host-auth-code-verifier', '__Host-carry', 'sb-127-auth-token']);
    for (const value of cookies.values()) expect(value).toMatch(/=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  });

  it('認証基盤への問い合わせが失敗しても、この端末の cookie は必ず消す', async () => {
    const server = createFakeAuthServer({ logoutStatus: 500 });
    const response = await signOut(post(`__Host-auth=${sessionCookieValue(3000)}`), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login' });
    expect(response.status).toBe(303);
    expect(setCookies(response).get('__Host-auth')).toBe('__Host-auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
  });

  it('期限切れのセッションを更新してから閉じても、更新したトークンを書き戻さず、認証の cookie を全部消す', async () => {
    const server = createFakeAuthServer();
    const response = await signOut(post(`__Host-auth=${sessionCookieValue(-60)}`), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login' });
    expect(response.status).toBe(303);
    const written = response.headers.getSetCookie();
    expect(written.length).toBeGreaterThan(0);
    for (const value of written) expect(value).toMatch(/^[^=]+=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  });

  it('http のページから https の口へ送らせたログアウトは 403(スキームも比べる)', async () => {
    const server = createFakeAuthServer();
    const config: SignOutConfig = { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login' };
    const response = await signOut(post(`__Host-auth=${sessionCookieValue(3000)}`, { origin: 'http://app.example' }), config);
    expect(response.status).toBe(403);
    expect(server.calls).toEqual([]);
  });

  it('同じオリジンのページから出たと確かめられない要求は 403(セッションを閉じない)、状態を変えないメソッドは 405', async () => {
    const server = createFakeAuthServer();
    const config: SignOutConfig = { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login' };
    const crossSite = await signOut(post(`__Host-auth=${sessionCookieValue(3000)}`, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), config);
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.getSetCookie()).toEqual([]);
    expect(server.calls).toEqual([]);
    const get = await signOut(new Request('https://app.example/api/auth/logout'), config);
    expect(get.status).toBe(405);
  });
});
