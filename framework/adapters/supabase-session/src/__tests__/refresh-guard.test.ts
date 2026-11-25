import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '../cookie-policy';
import { REFRESH_EXHAUSTED_CODE, REFRESH_FAILURE_LIMIT, REFRESH_TIME_LIMIT_MS, REFRESH_TOKEN_MAX_LENGTH, createRefreshBudget, unavailableUnlessSignedOut } from '../refresh-guard';
import { SessionUnreadableError, createSessionClient, refreshSession, signedInUserOf } from '../session-client';
import type { AuthOnlyDatabase } from '../session-client';
import { FAKE_AUTH_URL, createFakeAuthServer, fakeUser, recordingJar, sessionCookieValue } from './fakes/auth-server';

/**
 * 更新の口の守り(点検 16 回目 B16-1)。ライブラリは本物を動かす(認証基盤だけ偽物)。
 * 反例の形(点検 16 回目 B の探り): `refresh_token` が文字列でない cookie が 25 秒以上居座り、8 本撃つ。
 */

/** 更新の口の URL。 */
const TOKEN_URL = 'http://a/auth/v1/token?grant_type=refresh_token';

/** 更新の口の本文。 */
const body = (refreshToken: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });

/** 更新の口を叩いた本数。 */
const refreshCalls = (server: ReturnType<typeof createFakeAuthServer>): number => server.calls.filter((call) => call.path === '/auth/v1/token').length;

/** セッションの cookie に触った書き込み。 */
const sessionWrites = (jar: ReturnType<typeof recordingJar>): readonly unknown[] => jar.writes.filter((write) => write.name === SESSION_COOKIE_NAME || write.name.startsWith(`${SESSION_COOKIE_NAME}.`));

/** 認証基盤の v2 の失敗の答え。 */
const conflict = (): Response => Response.json({ code: 'conflict', message: 'x' }, { status: 409, headers: { 'x-supabase-api-version': '2024-01-01' } });

/** 偽の認証基盤の接続先。 */
const endpointOf = (server: ReturnType<typeof createFakeAuthServer>): { url: string; anonKey: string; fetch: typeof fetch } => ({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch });

afterEach(() => {
  vi.useRealTimers();
});

describe('形の壊れた更新トークンは送らない', () => {
  it.each([
    ['数', 12345],
    ['真偽', true],
    ['配列', ['x']],
    ['オブジェクト', { a: 1 }],
    ['長すぎる文字列', 'x'.repeat(REFRESH_TOKEN_MAX_LENGTH + 1)],
  ])('%s の cookie は認証基盤へ 0 本で、言い切りとして cookie を消す(B16-1 の反例)', async (_name, token) => {
    const server = createFakeAuthServer();
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60, token) }]);
    const started = Date.now();
    await refreshSession(endpointOf(server), jar);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(refreshCalls(server)).toBe(0);
    expect(sessionWrites(jar).length).toBeGreaterThan(0);
  });

  it('読みの側も未ログインになる(500 にしない)', async () => {
    const server = createFakeAuthServer();
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(endpointOf(server), recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60, 12345) }]));
    expect(signedInUserOf(await client.auth.getUser())).toBeNull();
  });

  it('上限ちょうどの文字列は送る(境)', async () => {
    const seen = vi.fn(() => Promise.resolve(new Response('{}')));
    await unavailableUnlessSignedOut(seen)(TOKEN_URL, body('x'.repeat(REFRESH_TOKEN_MAX_LENGTH)));
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('1 要求の予算', () => {
  it(`失敗が ${String(REFRESH_FAILURE_LIMIT)} 回で打ち切る: 本数は上限まで・cookie は消さない・読みは読めない`, async () => {
    const server = createFakeAuthServer({ tokenFailures: Array.from({ length: 20 }, () => conflict) });
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(endpointOf(server), jar);
    const started = Date.now();
    const result = await client.auth.getUser();
    expect(Date.now() - started).toBeLessThan(REFRESH_TIME_LIMIT_MS);
    expect(refreshCalls(server)).toBe(REFRESH_FAILURE_LIMIT);
    expect(sessionWrites(jar)).toEqual([]);
    expect(() => signedInUserOf(result)).toThrow(SessionUnreadableError);
    // ライブラリがセッションを手放したあとも、同じクライアントの読みを未ログインに化けさせない。
    const again = await client.auth.getUser();
    expect(() => signedInUserOf(again)).toThrow(SessionUnreadableError);
    expect(refreshCalls(server)).toBe(REFRESH_FAILURE_LIMIT);
  });

  it('上限の 1 つ手前で通れば、更新して新しい cookie を書く', async () => {
    const server = createFakeAuthServer({ tokenFailures: Array.from({ length: REFRESH_FAILURE_LIMIT - 1 }, () => conflict) });
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    await refreshSession(endpointOf(server), jar);
    expect(refreshCalls(server)).toBe(REFRESH_FAILURE_LIMIT);
    expect(jar.writes.some((write) => write.value.startsWith('base64-'))).toBe(true);
  });

  it('予算は同じ要求のクライアントで分ける: 尽きたあとの 2 本目は認証基盤へ送らない', async () => {
    const server = createFakeAuthServer({ tokenFailures: Array.from({ length: 20 }, () => conflict) });
    const refreshBudget = createRefreshBudget();
    const jarOf = (): ReturnType<typeof recordingJar> => recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    await refreshSession(endpointOf(server), jarOf(), refreshBudget);
    expect(refreshBudget.exhausted).toBe(true);
    const second = createSessionClient<AuthOnlyDatabase, 'public'>(endpointOf(server), jarOf(), { refreshBudget });
    const result = await second.auth.getUser();
    expect(() => signedInUserOf(result)).toThrow(SessionUnreadableError);
    expect(refreshCalls(server)).toBe(REFRESH_FAILURE_LIMIT);
  });

  it('前段で尽きた要求は最初から 0 本で閉じる', async () => {
    const server = createFakeAuthServer();
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(endpointOf(server), jar, { refreshBudget: createRefreshBudget(true) });
    const result = await client.auth.getUser();
    expect(() => signedInUserOf(result)).toThrow(SessionUnreadableError);
    expect(refreshCalls(server)).toBe(0);
    expect(sessionWrites(jar)).toEqual([]);
  });

  it('予算が尽きても、アクセストークンが生きていれば利用者を読める(期限の余白の中の更新)', async () => {
    const server = createFakeAuthServer({ tokenFailures: Array.from({ length: 20 }, () => conflict) });
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(30) }]);
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(endpointOf(server), jar);
    const { data } = await client.auth.getUser();
    expect(data.user?.id).toBe(fakeUser()['id']);
    expect(sessionWrites(jar)).toEqual([]);
  });

  it('答えない認証基盤は時間の上限で打ち切る(1 本の居座りも止める)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const signals: (AbortSignal | null | undefined)[] = [];
    const hang: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      vi.setSystemTime(Date.now() + REFRESH_TIME_LIMIT_MS);
      return Promise.reject(new Error('timeout'));
    };
    const budget = createRefreshBudget();
    const answer = await unavailableUnlessSignedOut(hang, budget)(TOKEN_URL, body('t'));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(budget.exhausted).toBe(true);
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error_code: REFRESH_EXHAUSTED_CODE });
  });

  it('試行は残りの時間で打ち切られ、呼び手の信号も効く', async () => {
    const outer = new AbortController();
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
        outer.abort();
      });
    const answer = await unavailableUnlessSignedOut(hang)(TOKEN_URL, { ...body('t'), signal: outer.signal });
    expect(answer.status).toBe(503);
  });

  it('時間が過ぎてから来た試行は送らない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const seen = vi.fn(() => Promise.resolve(conflict()));
    const budget = createRefreshBudget();
    const guarded = unavailableUnlessSignedOut(seen, budget);
    await guarded(TOKEN_URL, body('t'));
    vi.setSystemTime(Date.now() + REFRESH_TIME_LIMIT_MS);
    expect((await guarded(TOKEN_URL, body('t'))).status).toBe(400);
    expect(seen).toHaveBeenCalledOnce();
    expect(budget.exhausted).toBe(true);
  });

  it.each([
    ['接続の切断', () => Promise.reject(new TypeError('fetch failed'))],
    ['502', () => Promise.resolve(new Response(null, { status: 502 }))],
  ])('%s も予算を使う', async (_name, failure) => {
    const budget = createRefreshBudget();
    const guarded = unavailableUnlessSignedOut(failure, budget);
    for (let attempt = 1; attempt < REFRESH_FAILURE_LIMIT; attempt += 1) expect((await guarded(TOKEN_URL, body('t'))).status).toBe(503);
    expect((await guarded(TOKEN_URL, body('t'))).status).toBe(400);
    expect(budget.exhausted).toBe(true);
  });

  it('言い切りの答えは予算を使わない', async () => {
    const budget = createRefreshBudget();
    await unavailableUnlessSignedOut(() => Promise.resolve(new Response('{}', { status: 400 })), budget)(TOKEN_URL, body('t'));
    expect(budget).toMatchObject({ failures: 0, exhausted: false });
  });

  it('成功は失敗の数と時間を数え直す', async () => {
    const budget = createRefreshBudget();
    const answers = [conflict(), conflict(), new Response('{}')];
    const guarded = unavailableUnlessSignedOut(() => Promise.resolve(answers.shift() ?? conflict()), budget);
    for (let attempt = 0; attempt < 3; attempt += 1) await guarded(TOKEN_URL, body('t'));
    expect(budget).toMatchObject({ failures: 0, startedAt: null, exhausted: false });
  });

  it('更新の口のほかの要求は予算を使わず、信号も足さない', async () => {
    const seen = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const budget = createRefreshBudget();
    await unavailableUnlessSignedOut(seen, budget)('http://a/auth/v1/user', { method: 'GET' });
    expect(seen).toHaveBeenCalledWith('http://a/auth/v1/user', { method: 'GET' });
    expect(budget).toMatchObject({ failures: 0, startedAt: null });
  });
});
