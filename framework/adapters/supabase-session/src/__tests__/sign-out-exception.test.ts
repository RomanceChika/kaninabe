import { describe, expect, it } from 'vitest';
import { CLEAR_SITE_DATA, signOut } from '../sign-out';
import type { SignOutConfig } from '../sign-out';
import { createSessionClient } from '../session-client';
import type { AuthEndpoint, AuthOnlyDatabase } from '../session-client';
import { FAKE_AUTH_URL, createFakeAuthServer, recordingJar, sessionCookieValue } from './fakes/auth-server';

/**
 * ログアウトの口の**例外の契約**(`sign-out.ts`)。ライブラリが error を返す経路は `sign-out.test.ts` が見る。ここは
 * **例外を投げる経路**でも、この端末の認証の cookie を消す 303 と `Clear-Site-Data` を返し、**値の載った cookie を 1 本も書かない**ことを見る。
 *
 * 投げさせ方は注入点(接続先の URL と `fetch`)だけで作る(モジュールの差し替えはしない):
 *   - 組み立てで投げる … 接続先の URL が URL でない(`@supabase/supabase-js` が組み立てで止める)
 *   - サインアウトが reject する … ログアウトの口の応答が壊れている(`then` 以外の欄を読むと `TypeError`)。`@supabase/auth-js` は
 *     通信の失敗を error の値に包んで返すが、受け取った応答の欄(`ok`)を読む段の例外は包まずに投げる(応答の形の崩れ・ライブラリの不具合の代わり)
 * 各経路で、ライブラリが本当に投げることを先に確かめる(依存の版が変わって前提が崩れたら、このテストは空振りになるので赤にする)。
 */

/** `then` 以外の欄を読むと例外になる偽の応答(`await` では止まらず、欄を読んだところで壊れる)。 */
function brokenResponse(): Response {
  return new Proxy({} as Response, {
    get: (_target, key) => {
      if (key === 'then') return undefined;
      throw new TypeError('broken response');
    },
  });
}

/** ログアウトの口だけ壊れた応答を返す接続先(ほかは偽の認証基盤が答える)。 */
function brokenLogoutEndpoint(): AuthEndpoint {
  const server = createFakeAuthServer();
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return url.pathname === '/auth/v1/logout' ? Promise.resolve(brokenResponse()) : server.fetch(input, init);
  }) as typeof fetch;
  return { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: fetchImpl };
}

/** 同じオリジンのページからのフォーム送信(cookie つき)。 */
function post(cookie: string): Request {
  return new Request('https://app.example/api/auth/logout', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', cookie },
  });
}

/** 消去の書き込みの形(値が空・寿命 0・約束の属性)。 */
const EXPIRED = /^[^=]+=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/;

/** 例外の経路(名前・接続先・要求の cookie のセッション)。 */
const CASES: readonly { readonly name: string; readonly endpoint: AuthEndpoint; readonly session: string }[] = [
  { name: '組み立てで投げる', endpoint: { url: 'not a url', anonKey: 'anon' }, session: sessionCookieValue(3000) },
  { name: 'サインアウトが reject する', endpoint: brokenLogoutEndpoint(), session: sessionCookieValue(3000) },
  { name: '期限切れのトークンを更新してからサインアウトが reject する', endpoint: brokenLogoutEndpoint(), session: sessionCookieValue(-60) },
];

describe('ログアウトの口の例外の契約', () => {
  for (const { name, endpoint, session } of CASES) {
    it(`認証基盤のクライアントが例外を投げても(${name})、認証の cookie を全部消し Clear-Site-Data つきで着地へ 303(値の載った cookie を書かない)`, async () => {
      // 前提: この経路でライブラリは本当に投げる(error の値を返すのではなく)。
      const cookies = [{ name: '__Host-auth', value: session }];
      await expect((async () => createSessionClient<AuthOnlyDatabase, 'public'>(endpoint, recordingJar(cookies)).auth.signOut({ scope: 'local' }))()).rejects.toThrow();

      const config: SignOutConfig = { endpoint, landingPath: '/login', alsoExpire: ['__Host-carry'] };
      const response = await signOut(post(`__Host-auth=${session}; __Host-auth-code-verifier=v; sb-127-auth-token=legacy; unrelated=x`), config);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login');
      expect(response.headers.get('clear-site-data')).toBe(CLEAR_SITE_DATA);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const written = response.headers.getSetCookie();
      const names = written.map((value) => value.split('=')[0] ?? '');
      expect(names).toEqual(expect.arrayContaining(['__Host-auth', '__Host-auth-code-verifier', '__Host-carry', 'sb-127-auth-token']));
      expect(names).not.toContain('unrelated');
      for (const value of written) expect(value).toMatch(EXPIRED);
    });
  }
});
