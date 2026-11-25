import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME } from '../cookie-policy';
import { unavailableUnlessSignedOut } from '../refresh-guard';
import { SessionUnreadableError, createSessionClient, legacyCookieRemovals, refreshSession, signedInUserOf } from '../session-client';
import type { AuthOnlyDatabase } from '../session-client';
import { FAKE_AUTH_URL, createFakeAuthServer, recordingJar, sessionCookieValue } from './fakes/auth-server';

/**
 * サーバーのクライアントの作り方と、前段の更新(`session-client.ts`)。
 * **ライブラリが書く cookie は、書き手に渡る前に必ず約束の属性になる**ことを、実際のライブラリを動かして見る(ネットワークは偽物)。
 */
describe('サーバーのクライアント', () => {
  it('OAuth を始めると、検証子の cookie が約束の名前と属性で書き手に渡り、キャッシュ止めのヘッダも渡る', async () => {
    const jar = recordingJar();
    const client = createSessionClient<AuthOnlyDatabase, 'public'>({ url: FAKE_AUTH_URL, anonKey: 'anon' }, jar);
    await client.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: 'https://app.example/cb', skipBrowserRedirect: true } });
    expect(jar.writes.length).toBeGreaterThan(0);
    for (const write of jar.writes) {
      expect(write.name.startsWith(`${SESSION_COOKIE_NAME}-`)).toBe(true);
      expect(write.name.endsWith('-code-verifier')).toBe(true);
      expect(write.options).toMatchObject(AUTH_COOKIE_ATTRIBUTES);
      expect(Object.keys(write.options).sort()).toEqual(['httpOnly', 'maxAge', 'path', 'sameSite', 'secure']);
      // ライブラリは 400 日を渡してくるが、検証子は OAuth の往復のあいだ(10 分)だけ持つ。
      expect(write.options.maxAge).toBe(600);
    }
    expect(jar.headers.some((headers) => headers['Cache-Control']?.includes('no-store') === true)).toBe(true);
  });

  it('スキーマ名を渡せる(業務データの読み取りに使うクライアント)', () => {
    const client = createSessionClient<AuthOnlyDatabase, 'public'>({ url: FAKE_AUTH_URL, anonKey: 'anon' }, recordingJar(), { db: { schema: 'public' } });
    expect(typeof client.from).toBe('function');
  });
});

describe('前段の更新', () => {
  it('期限切れのセッションを更新すると、新しいセッションの cookie を約束の属性で書き、キャッシュ止めのヘッダを渡す', async () => {
    const server = createFakeAuthServer();
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, jar);
    expect(server.calls.map((call) => call.path)).toContain('/auth/v1/token');
    const sessionWrites = jar.writes.filter((write) => write.name === SESSION_COOKIE_NAME || write.name.startsWith(`${SESSION_COOKIE_NAME}.`));
    expect(sessionWrites.some((write) => write.value !== '')).toBe(true);
    for (const write of jar.writes) expect(write.options).toMatchObject(AUTH_COOKIE_ATTRIBUTES);
    expect(jar.headers.some((headers) => headers['Cache-Control']?.includes('no-store') === true)).toBe(true);
  });

  it('期限内なら書かない。未ログインでも落ちない', async () => {
    const server = createFakeAuthServer();
    const fresh = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(3000) }]);
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, fresh);
    expect(fresh.writes).toEqual([]);
    const anonymous = recordingJar();
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, anonymous);
    expect(anonymous.writes).toEqual([]);
  });

  it('移行前の名前の cookie が残っていれば消す(スクリプトから読める属性で書かれていたため)', async () => {
    const server = createFakeAuthServer();
    const jar = recordingJar([
      { name: 'sb-127-auth-token.0', value: 'legacy' },
      { name: 'unrelated', value: 'x' },
    ]);
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, jar);
    expect(jar.writes).toEqual([{ name: 'sb-127-auth-token.0', value: '', options: { ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 } }]);
    expect(legacyCookieRemovals([{ name: 'unrelated', value: 'x' }])).toEqual([]);
  });
});

/** 認証基盤の v2 の失敗の応答(本文の `code` が文字列)。 */
function apiFailure(status: number, code: string): Response {
  return Response.json({ code, message: 'x' }, { status, headers: { 'x-supabase-api-version': '2024-01-01' } });
}

/** 期限切れのセッションの cookie を持つ書き手。 */
const expiredJar = (): ReturnType<typeof recordingJar> => recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);

/** セッションの cookie を消した書き込み。 */
const sessionRemovals = (jar: ReturnType<typeof recordingJar>): readonly unknown[] => jar.writes.filter((write) => (write.name === SESSION_COOKIE_NAME || write.name.startsWith(`${SESSION_COOKIE_NAME}.`)) && (write.value === '' || write.options.maxAge === 0));

describe('更新の口の答えの閉じた表(点検 15 回目 O15-2)', () => {
  it.each([
    ['409 の競合', () => apiFailure(409, 'conflict')],
    ['429 の上限', () => apiFailure(429, 'over_request_rate_limit')],
    ['500', () => apiFailure(500, 'unexpected_failure')],
    ['本文の読めない 502', () => new Response('<html>', { status: 502 })],
  ])('%s の 1 回では cookie を消さず、再試行で更新して新しい cookie を書く', async (_name, failure) => {
    const server = createFakeAuthServer({ tokenFailures: [failure] });
    const jar = expiredJar();
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, jar);
    expect(sessionRemovals(jar)).toEqual([]);
    expect(jar.writes.some((write) => write.value.startsWith('base64-'))).toBe(true);
    expect(server.calls.filter((call) => call.path === '/auth/v1/token').length).toBe(2);
  });

  it.each(['refresh_token_already_used', 'refresh_token_not_found', 'validation_failed'])('%s は言い切りなので cookie を消す(対照)', async (code) => {
    const server = createFakeAuthServer({ tokenFailures: [() => apiFailure(400, code)] });
    const jar = expiredJar();
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, jar);
    expect(sessionRemovals(jar).length).toBeGreaterThan(0);
    expect(server.calls.filter((call) => call.path === '/auth/v1/token').length).toBe(1);
  });

  it.each([
    ['bad_json(B16-1)', () => apiFailure(400, 'bad_json')],
    ['表の外の 400', () => apiFailure(400, 'some_new_code')],
    ['本文の読めない 403', () => new Response('<html>', { status: 403 })],
  ])('読み替えの外の %s はライブラリへ渡り、再試行しない(1 本で終わる)', async (_name, failure) => {
    const server = createFakeAuthServer({ tokenFailures: [failure] });
    const jar = expiredJar();
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, jar);
    expect(sessionRemovals(jar).length).toBeGreaterThan(0);
    expect(server.calls.filter((call) => call.path === '/auth/v1/token').length).toBe(1);
  });

  it.each([
    ['表の中の答え(v2 の code)', 'http://a/auth/v1/token?grant_type=refresh_token', () => apiFailure(400, 'refresh_token_not_found'), 400],
    ['表の中の答え(error_code)', 'http://a/auth/v1/token?grant_type=refresh_token', () => Response.json({ error_code: 'session_expired' }, { status: 403 }), 403],
    ['表の外の 4xx はそのまま', 'http://a/auth/v1/token?grant_type=refresh_token', () => Response.json({ code: 400 }, { status: 400 }), 400],
    ['本文が null でもそのまま', 'http://a/auth/v1/token?grant_type=refresh_token', () => Response.json(null, { status: 400 }), 400],
    ['403 はそのまま', 'http://a/auth/v1/token?grant_type=refresh_token', () => new Response('x', { status: 403 }), 403],
    ['3xx はそのまま', 'http://a/auth/v1/token?grant_type=refresh_token', () => new Response(null, { status: 302 }), 302],
    ['409 を読み替える', 'http://a/auth/v1/token?grant_type=refresh_token', () => apiFailure(409, 'conflict'), 503],
    ['429 を読み替える', 'http://a/auth/v1/token?grant_type=refresh_token', () => apiFailure(429, 'over_request_rate_limit'), 503],
    ['500 を読み替える', 'http://a/auth/v1/token?grant_type=refresh_token', () => apiFailure(500, 'unexpected_failure'), 503],
    ['599 を読み替える', 'http://a/auth/v1/token?grant_type=refresh_token', () => new Response(null, { status: 599 }), 503],
    ['成功はそのまま', 'http://a/auth/v1/token?grant_type=refresh_token', () => new Response('{}', { status: 200 }), 200],
    ['ほかの grant はそのまま', 'http://a/auth/v1/token?grant_type=pkce', () => apiFailure(409, 'conflict'), 409],
    ['ほかの口はそのまま', 'http://a/auth/v1/user', () => apiFailure(500, 'unexpected_failure'), 500],
  ] as const)('読み替え: %s', async (_name, url, answer, status) => {
    const read = unavailableUnlessSignedOut(() => Promise.resolve(answer()));
    expect((await read(url)).status).toBe(status);
    expect((await read(new URL(url))).status).toBe(status);
    expect((await read(new Request(url, { method: 'POST' }))).status).toBe(status);
  });
});

describe('利用者の読み分け(点検 15 回目 O15-2)', () => {
  const user = { id: 'u' };
  const nobody = { user: null };
  const api = (status: number, code: string): AuthApiError => new AuthApiError('x', status, code);

  it('利用者がいれば利用者', () => {
    expect(signedInUserOf({ data: { user }, error: null })).toBe(user);
  });

  it.each([
    ['答えが無い', null],
    ['欄が無い', undefined],
    ['セッションが無い', new AuthSessionMissingError()],
    ['壊れたトークン', api(403, 'bad_jwt')],
    ['認可の見出しが無い', api(401, 'no_authorization')],
    ['終わったセッション', api(403, 'session_not_found')],
    ['期限切れのセッション', api(403, 'session_expired')],
    ['消えた利用者', api(403, 'user_not_found')],
    ['止められた利用者', api(403, 'user_banned')],
    ['再利用された更新トークン', api(400, 'refresh_token_already_used')],
    ['無い更新トークン', api(400, 'refresh_token_not_found')],
    ['形の壊れた更新トークン', api(400, 'validation_failed')],
  ])('%s は未ログイン', (_name, error) => {
    expect(signedInUserOf({ data: nobody, error })).toBeNull();
  });

  it.each([
    ['5xx', new AuthRetryableFetchError('x', 500), 'AuthRetryableFetchError'],
    ['通信の失敗', new AuthRetryableFetchError('x', 0), 'AuthRetryableFetchError'],
    ['表の外の答え', api(429, 'over_request_rate_limit'), 'AuthApiError'],
    ['code の無い答え', new AuthApiError('x', 400, undefined), 'AuthApiError'],
    ['ただの例外', new Error('x'), 'Error'],
    ['例外でない値', 'x', 'unknown'],
  ])('%s は読めない(未ログインにもログイン済みにもしない)', (_name, error, reason) => {
    const read = (): unknown => signedInUserOf({ data: nobody, error });
    expect(read).toThrow(SessionUnreadableError);
    expect(read).toThrow(`セッションを読めません(${reason})`);
  });
});
