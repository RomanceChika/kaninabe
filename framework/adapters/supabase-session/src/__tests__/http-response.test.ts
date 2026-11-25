import { describe, expect, it } from 'vitest';
import { cookieWrite, expiredCookie } from '../cookie-policy';
import { NO_STORE, authRedirectOrigins, lastWritePerName, redirectResponse, refusalResponse, requestCookies, sameOriginPath, setCookieValue } from '../http-response';

/** 応答の部品(`http-response.ts`)。cookie は `Set-Cookie` でしか渡さず、応答は必ずキャッシュさせない。 */
describe('認証の口の応答の部品', () => {
  it('要求の Cookie ヘッダを読む(無い・空なら空)', () => {
    expect(requestCookies(new Request('https://app.example/'))).toEqual([]);
    expect(requestCookies(new Request('https://app.example/', { headers: { cookie: '' } }))).toEqual([]);
    expect(requestCookies(new Request('https://app.example/', { headers: { cookie: '__Host-auth=a; other=b; =c' } }))).toEqual([
      { name: '__Host-auth', value: 'a' },
      { name: 'other', value: 'b' },
    ]);
  });

  it('Set-Cookie は HttpOnly・Secure・SameSite=Lax・Path=/ を持ち、Domain を持たない', () => {
    const value = setCookieValue(cookieWrite('__Host-auth', 'v', { maxAge: 60 }));
    expect(value).toBe('__Host-auth=v; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(value).not.toMatch(/Domain/i);
  });

  it('同じ名前の書き込みは後のものだけを残す', () => {
    const first = cookieWrite('__Host-auth', 'v', {});
    const second = expiredCookie('__Host-auth');
    const other = cookieWrite('__Host-x', 'y', {});
    expect(lastWritePerName([first, other, second])).toEqual([other, second]);
  });

  it('転送の応答は 303 で、cookie を 1 本ずつ Set-Cookie に載せ、キャッシュの禁止を付ける', () => {
    const response = redirectResponse('https://auth.example/authorize', [cookieWrite('__Host-a', '1', {}), cookieWrite('__Host-b', '2', {})], {
      'Cache-Control': 'private',
      Pragma: 'no-cache',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://auth.example/authorize');
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.getSetCookie()).toEqual([
      '__Host-a=1; Path=/; HttpOnly; Secure; SameSite=Lax',
      '__Host-b=2; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(redirectResponse('/login', []).headers.getSetCookie()).toEqual([]);
  });

  it('拒否の応答は本文を持たず、キャッシュさせない', async () => {
    const response = refusalResponse(403);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
    expect(await response.text()).toBe('');
  });
});

describe('着地の判定と外の行き先の表(点検 10 回目 B10-2)', () => {
  it.each([
    ['/login', '/login'],
    ['/login?error=start_failed', '/login?error=start_failed'],
    ['/a/./b/../c', '/a/c'],
  ])('sameOriginPath(%s) は正規化した相対パス', (value, expected) => {
    expect(sameOriginPath(value, 'landingPath')).toBe(expected);
  });

  it.each([['https://evil.example'], ['//evil.example'], ['/\\evil.example'], ['/.//evil.example'], ['javascript:alert(1)'], ['login'], ['']])('sameOriginPath(%s) は例外(値を文面に載せない)', (value) => {
    expect(() => sameOriginPath(value, 'landingPath')).toThrow(/^landingPath は同じオリジンの相対パス/u);
    try {
      sameOriginPath(value, 'landingPath');
    } catch (error) {
      if (value !== '') expect(String(error)).not.toContain(value);
    }
  });

  it('外の行き先の表は認証基盤の接続先のオリジン 1 つだけ', () => {
    expect(authRedirectOrigins({ url: 'https://project.supabase.example/sub/' })).toEqual(['https://project.supabase.example']);
    expect(authRedirectOrigins({ url: 'http://127.0.0.1:54321' })).toEqual(['http://127.0.0.1:54321']);
  });
});
