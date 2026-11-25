/**
 * **認証の cookie の約束**(保証 `fw_session_cookie_policy`)の見張り。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-1 / §6-2(案 A。ASVS V3.3.1 / V3.3.3 / V3.3.4)
 *
 * セッションの adapter(`framework/adapters/supabase-session`)が**書く cookie と消す cookie の全部**が、約束の属性
 * (`__Host-` の名前・`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`・`Domain` なし)を持つこと、サインインの開始とログアウトの口が
 * 要求の出どころを確かめること、ログアウトの範囲がこの端末だけであることを、実際の認証基盤のライブラリを動かして見る
 * (ネットワークには出ない。認証基盤の応答は偽物)。adapter のユニットテスト(100%)が細部を持ち、ここは保証の言い切りを持つ。
 */

import { describe, expect, it } from 'vitest';
import { signOut, startSignIn } from '@kaninabe/adapter-supabase-session';

/** 約束の属性(Set-Cookie の末尾)。寿命の欄は任意。 */
const POLICY = /^__Host-[^=]+=[^;]*;( Max-Age=\d+;)? Path=\/; HttpOnly; Secure; SameSite=Lax$/;

/** 同じオリジンのページから出た要求のヘッダ。 */
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example' } as const;

/** 偽の認証基盤(ログアウトの口だけを答え、叩かれた範囲を残す)。 */
function fakeAuth(): { readonly fetch: typeof fetch; readonly scopes: string[] } {
  const scopes: string[] = [];
  const respond = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/auth/v1/logout') scopes.push(url.searchParams.get('scope') ?? '');
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  return { fetch: respond as typeof fetch, scopes };
}

/** 期限内のセッションの cookie の値(`@supabase/ssr` の形)。 */
function sessionValue(): string {
  const session = { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3000, user: { id: 'u' } };
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

describe('認証の cookie の約束', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONCOOKIE-001
  it('サインインの開始とログアウトが書く cookie・消す cookie は、全部が __Host- の HttpOnly・Secure・SameSite=Lax・Path=/ で、Domain を持たず、検証子は 10 分で切れる', async () => {
    const auth = fakeAuth();
    const endpoint = { url: 'http://auth.invalid', anonKey: 'anon', fetch: auth.fetch };
    const started = await startSignIn(
      new Request('https://app.example/api/auth/sign-in', { method: 'POST', headers: SAME_ORIGIN, body: new URLSearchParams({ code: 'abc' }) }),
      { endpoint, provider: 'discord', callbackPath: '/api/auth/callback', failurePath: '/login', carry: { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 32, pattern: /^[A-Za-z0-9_-]+$/ } },
    );
    const ended = await signOut(
      new Request('https://app.example/api/auth/logout', { method: 'POST', headers: { ...SAME_ORIGIN, cookie: `__Host-auth=${sessionValue()}; __Host-auth-code-verifier=v; sb-ref-auth-token=old` } }),
      { endpoint, landingPath: '/login', alsoExpire: ['__Host-carry'] },
    );

    const written = [...started.headers.getSetCookie(), ...ended.headers.getSetCookie()];
    expect(written.length).toBeGreaterThanOrEqual(5);
    const legacy = written.filter((value) => value.startsWith('sb-'));
    expect(legacy).toEqual(['sb-ref-auth-token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax']);
    for (const value of written.filter((entry) => !entry.startsWith('sb-'))) expect(value).toMatch(POLICY);
    // PKCE の検証子は OAuth の往復のあいだ(10 分)だけ持つ(ライブラリの既定の 400 日を縮める)。
    const verifiers = started.headers.getSetCookie().filter((value) => /^__Host-auth-[^=]*code-verifier=[^;]+;/.test(value));
    expect(verifiers.length).toBeGreaterThan(0);
    for (const value of verifiers) expect(value).toContain('; Max-Age=600;');
    expect(auth.scopes).toEqual(['local']);
    expect(ended.headers.get('clear-site-data')).toBe('"cache", "cookies", "storage"');
  });

  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONCOOKIE-002
  it('同じオリジンのページから出たと確かめられない要求は、開始もログアウトも 403 で、cookie を 1 本も書かず、セッションを閉じない', async () => {
    const auth = fakeAuth();
    const endpoint = { url: 'http://auth.invalid', anonKey: 'anon', fetch: auth.fetch };
    const cross = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: 'app.example' };
    const started = await startSignIn(new Request('https://app.example/api/auth/sign-in', { method: 'POST', headers: cross }), {
      endpoint,
      provider: 'discord',
      callbackPath: '/api/auth/callback',
      failurePath: '/login',
    });
    const ended = await signOut(new Request('https://app.example/api/auth/logout', { method: 'POST', headers: { ...cross, cookie: `__Host-auth=${sessionValue()}` } }), {
      endpoint,
      landingPath: '/login',
    });

    expect([started.status, ended.status]).toEqual([403, 403]);
    expect([...started.headers.getSetCookie(), ...ended.headers.getSetCookie()]).toEqual([]);
    expect(auth.scopes).toEqual([]);
  });
});
