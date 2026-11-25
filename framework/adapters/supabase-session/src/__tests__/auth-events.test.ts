/**
 * 認証の事象の記録(V16.3.1)のテスト —— サインインの開始・ログアウトが、事象・結末・要求の識別子だけを 1 行出す。
 *
 * 確かめるのは、①事象ごとの行の全体(`toEqual`) ②トークン・cookie・運ぶ値・メールアドレスが行に載らない
 * ③出どころの拒否が記録される ④ログアウトする人のメンバー ID は、署名を確かめたクレームの `sub` から読む(読めなくても止めない)。
 */

import { describe, expect, it } from 'vitest';
import type { Logger, LogRecord } from '@kaninabe/runtime/ports';
import { startEventOf, startOutcome, startSignIn } from '../sign-in';
import type { SignInStartConfig } from '../sign-in';
import { signOut, subjectOf } from '../sign-out';
import { FAKE_AUTH_URL, createFakeAuthServer, sessionCookieValue } from './fakes/auth-server';

/** 出した行を貯める口。 */
function fakeLogger(): Logger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, write: (record) => void records.push(record) };
}

const CARRY = { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 16, pattern: /^[A-Za-z0-9_-]+$/ } as const;

function signInConfig(logger: Logger, overrides: Partial<SignInStartConfig> = {}): SignInStartConfig {
  return { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon' }, provider: 'discord', callbackPath: '/api/auth/callback', failurePath: '/login?error=start_failed', carry: CARRY, logger, ...overrides };
}

function formPost(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/api/auth/sign-in', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', 'x-request-id': 'req-77', ...headers },
    body: new URLSearchParams(fields),
  });
}

function logoutPost(cookie: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/api/auth/logout', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', cookie, 'x-request-id': 'req-88', ...headers },
  });
}

describe('サインインの開始の記録', () => {
  it('認可の URL へ送れたら sign_in_started(info・redirected)を 1 行。運ぶ値は載せない', async () => {
    const logger = fakeLogger();

    await startSignIn(formPost({ code: 'secret-invite-code' }), signInConfig(logger, { carry: { ...CARRY, maxLength: 32 } }));

    expect(logger.records).toEqual([{ level: 'info', security_event: 'sign_in_started', actor_id: null, decision: 'redirected', request_id: 'req-77' }]);
    expect(JSON.stringify(logger.records)).not.toContain('secret-invite-code');
  });

  it('本文が不正(長すぎる運ぶ値)なら sign_in_start_failed(warn・invalid_form)', async () => {
    const logger = fakeLogger();

    const response = await startSignIn(formPost({ code: 'x'.repeat(17) }), signInConfig(logger));

    expect(response.status).toBe(400);
    expect(logger.records).toEqual([{ level: 'warn', security_event: 'sign_in_start_failed', actor_id: null, decision: 'invalid_form', request_id: 'req-77' }]);
  });

  it('出どころを確かめられない要求は origin_refused(warn)を 1 行。開始の事象は出さない', async () => {
    const logger = fakeLogger();

    const response = await startSignIn(formPost({ code: 'abc' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), signInConfig(logger));

    expect(response.status).toBe(403);
    expect(logger.records).toEqual([{ level: 'warn', security_event: 'origin_refused', refusal_code: 'cross_origin', request_id: 'req-77' }]);
  });

  it('開始の結末から事象を決める: 認可の URL があれば sign_in_started、始められなければ sign_in_start_failed', () => {
    const failure = '/login?error=start_failed';
    const auth = 'https://auth.example';
    expect(startEventOf(startOutcome({ data: { url: 'https://auth.example/authorize' }, error: null }, [], failure, auth))).toEqual({ event: 'sign_in_started', decision: 'redirected' });
    expect(startEventOf(startOutcome({ data: { url: null }, error: new Error('x') }, [], failure, auth))).toEqual({ event: 'sign_in_start_failed', decision: 'start_failed' });
    expect(startEventOf(startOutcome({ data: { url: '' }, error: null }, [], failure, auth))).toEqual({ event: 'sign_in_start_failed', decision: 'start_failed' });
    expect(startEventOf(startOutcome({ data: { url: 'https://evil.example/authorize' }, error: null }, [], failure, auth))).toEqual({ event: 'sign_in_start_failed', decision: 'start_failed' });
  });

  it('状態を変えないメソッド(405)は何も出さない', async () => {
    const logger = fakeLogger();

    await startSignIn(new Request('https://app.example/api/auth/sign-in'), signInConfig(logger));

    expect(logger.records).toEqual([]);
  });
});

describe('ログアウトの記録', () => {
  it('閉じられたら signed_out(info・session_ended)を 1 行。cookie の値は載せない', async () => {
    const logger = fakeLogger();
    const server = createFakeAuthServer();
    const cookie = `__Host-auth=${sessionCookieValue(3000)}`;

    const response = await signOut(logoutPost(cookie), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login', logger });

    expect(response.status).toBe(303);
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]).toMatchObject({ level: 'info', security_event: 'signed_out', decision: 'session_ended', request_id: 'req-88' });
    expect(JSON.stringify(logger.records)).not.toContain('old-access-token');
    expect(JSON.stringify(logger.records)).not.toContain('old-refresh-token');
  });

  it('認証基盤がセッションを閉じられなくても cookie は消し、sign_out_degraded(warn・backend_failed)を 1 行', async () => {
    const logger = fakeLogger();
    const server = createFakeAuthServer({ logoutStatus: 500 });

    const response = await signOut(logoutPost(`__Host-auth=${sessionCookieValue(3000)}`), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login', logger });

    expect(response.status).toBe(303);
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]).toMatchObject({ level: 'warn', security_event: 'sign_out_degraded', decision: 'backend_failed' });
  });

  it('出どころを確かめられない要求は origin_refused だけを出す', async () => {
    const logger = fakeLogger();
    const server = createFakeAuthServer();

    const response = await signOut(logoutPost('', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), { endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon', fetch: server.fetch }, landingPath: '/login', logger });

    expect(response.status).toBe(403);
    expect(logger.records).toEqual([{ level: 'warn', security_event: 'origin_refused', refusal_code: 'cross_origin', request_id: 'req-88' }]);
  });
});

describe('subjectOf(ログアウトする人のメンバー ID)', () => {
  const CASES: readonly { readonly name: string; readonly client: Parameters<typeof subjectOf>[0]; readonly expected: string | null }[] = [
    { name: '署名を確かめたクレームの sub', client: { auth: { getClaims: () => Promise.resolve({ data: { claims: { sub: 'user-1' } }, error: null }) } }, expected: 'user-1' },
    { name: '確かめられなかった(error)', client: { auth: { getClaims: () => Promise.resolve({ data: null, error: new Error('x') }) } }, expected: null },
    { name: 'sub が文字列でない', client: { auth: { getClaims: () => Promise.resolve({ data: { claims: { sub: 5 } }, error: null }) } }, expected: null },
    { name: 'sub が空', client: { auth: { getClaims: () => Promise.resolve({ data: { claims: { sub: '' } }, error: null }) } }, expected: null },
    { name: 'getClaims が無い', client: { auth: {} }, expected: null },
    { name: 'getClaims が例外を投げる', client: { auth: { getClaims: () => Promise.reject(new Error('boom')) } }, expected: null },
  ];
  for (const { name, client, expected } of CASES) {
    it(name, async () => {
      expect(await subjectOf(client)).toBe(expected);
    });
  }
});
