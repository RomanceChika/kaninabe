import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '../cookie-policy';
import { createSessionClient } from '../session-client';
import type { AuthOnlyDatabase } from '../session-client';
import { recordingJar, sessionCookieValue } from './fakes/auth-server';

/**
 * 認証基盤の呼び出しは転送について行かない(ASVS V15.3.2)。`fetch` を差し込まない既定は `safeFetch`(`redirect: "error"`)で、
 * 差し込んだ `fetch`(テストの口)はそのまま使われる。グローバルの `fetch` の差し替えで引数を見る(実物のサーバーの 3xx は製品の木の `outbound-redirect.unit.test.ts` が見る)。
 */
describe('認証基盤の呼び出しの既定の fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetch を差し込まなければ redirect: "error" で呼ぶ', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init ?? {});
        return Promise.resolve(new Response(JSON.stringify({ message: 'no' }), { status: 401 }));
      }),
    );
    const client = createSessionClient<AuthOnlyDatabase, 'public'>({ url: 'https://auth.example.invalid', anonKey: 'anon' }, recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(3000) }]));
    await client.auth.getUser();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.map((call) => call.redirect)).toEqual(calls.map(() => 'error'));
  });

  it('差し込んだ fetch はそのまま使う(テストの口)', async () => {
    const injected = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'no' }), { status: 401 })));
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(
      { url: 'https://auth.example.invalid', anonKey: 'anon', fetch: injected as unknown as typeof fetch },
      recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(3000) }]),
    );
    await client.auth.getUser();
    expect(injected).toHaveBeenCalled();
  });
});
