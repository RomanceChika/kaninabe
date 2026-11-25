/**
 * 有料の口の関門を実物のまま叩く道具(`@kaninabe/runtime/testing/http/paid-gate`)のテスト。
 *
 * 生成した見張りテストは、この道具で「未ログインは 401・役を持たない人は 403 で、本文を読まず、枠の RPC も有料の宛先も呼ばずに閉じる」ことを見る。
 * ここでは道具そのものが**閉じていない口を閉じていないと言う**ことを、点検 5 回目 B5-2 の形(役を捨てる認可・meter を呼ばない消費)の負例で固定し、
 * 正しい口(`runPaidEntry` に本物の認可の形を渡す)では何も言わない対照を置く。分類は道の形の表で、判定は観測の表で網羅する。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_SIGNED_IN_USER_ID,
  FORBIDDEN_REFUSAL,
  UNAUTHENTICATED_REFUSAL,
  classifyBackendCall,
  gateLeaks,
  installFakeBackend,
  observeGate,
  runInNextRequestContext,
  sessionCookieHeader,
} from '@kaninabe/runtime/testing/http/paid-gate';
import type { BackendCall, FakeBackend, GateObservation } from '@kaninabe/runtime/testing/http/paid-gate';
import type { AuthorizeOutcome } from '../paid-entry';
import { runPaidEntry } from '../paid-entry';
import { safeFetch } from '../safe-fetch';

/** cookie の名前(見本)。 */
const COOKIE = '__Host-auth';

/** 後段の見本の URL。 */
const BACKEND = 'http://127.0.0.1:54399';

/** 何もしないログの口。 */
const LOGGER = { write: (): void => undefined };

beforeAll(() => {
  (globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
});

let backend: FakeBackend | null = null;

afterEach(() => {
  backend?.dispose();
  backend = null;
});

/** 要求の文脈の cookie を読む(製品の認証が `cookies()` を読むのと同じ口)。 */
async function sessionUserId(): Promise<string | null> {
  const specifier = 'next/headers';
  const { cookies } = (await import(/* @vite-ignore */ specifier)) as { cookies: () => Promise<{ get(name: string): { value: string } | undefined }> };
  const value = (await cookies()).get(COOKIE)?.value;
  if (value === undefined) return null;
  const response = await safeFetch(`${BACKEND}/auth/v1/user`, { headers: { authorization: 'Bearer x' } });
  return ((await response.json()) as { id: string }).id;
}

/** 役の条件の行を読む(行が無ければ役なし)。 */
async function holdsRole(actorId: string): Promise<boolean> {
  const response = await safeFetch(`${BACKEND}/rest/v1/members?id=eq.${actorId}`);
  return ((await response.json()) as unknown[]).length > 0;
}

/** 正しい認可(未ログイン 401・役なし 403)。 */
async function authorize(): Promise<AuthorizeOutcome> {
  const actorId = await sessionUserId();
  if (actorId === null) return { kind: 'unauthenticated' };
  return (await holdsRole(actorId)) ? { kind: 'ok', actorId } : { kind: 'forbidden', actorId };
}

/** 口の見本を作る(認可と枠の消費を差し替えられる)。 */
function route(over: { authorize?: () => Promise<AuthorizeOutcome>; consume?: (actorId: string) => Promise<'used'> } = {}): (request: Request) => Promise<Response> {
  return (request) =>
    runPaidEntry(request, {
      operation: 'answer',
      maxBodyBytes: 1024,
      authorize: over.authorize ?? authorize,
      bindings: { roleTables: { implications: {} } } as never,
      role: 'member',
      logger: LOGGER,
      parse: (body) => ({ kind: 'ok', value: body }),
      consume:
        over.consume ??
        (async () => {
          await safeFetch(`${BACKEND}/rest/v1/rpc/consume_quota`, { method: 'POST' });
          return 'used';
        }),
      handler: async () => {
        await safeFetch('https://api.paid.example/v1/messages', { method: 'POST' });
        return new Response('paid', { status: 200 });
      },
    });
}

/** 口に送る要求(本文つき)。 */
function post(): Request {
  return new Request('https://app.example/api/ai/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"q":1}' });
}

describe('classifyBackendCall(道の形の表)', () => {
  it.each([
    [`${BACKEND}/auth/v1/user`, 'GET', { kind: 'auth-user', target: '/auth/v1/user' }],
    [`${BACKEND}/auth/v1/user`, 'PUT', { kind: 'auth-other', target: '/auth/v1/user' }],
    [`${BACKEND}/auth/v1/token?grant_type=refresh_token`, 'POST', { kind: 'auth-other', target: '/auth/v1/token' }],
    [`${BACKEND}/rest/v1/rpc/consume_ai_quota`, 'POST', { kind: 'rpc', target: 'consume_ai_quota' }],
    [`${BACKEND}/rest/v1/members?id=eq.1`, 'GET', { kind: 'read', target: 'members' }],
    [`${BACKEND}/rest/v1/members`, 'HEAD', { kind: 'read', target: 'members' }],
    [`${BACKEND}/rest/v1/members`, 'PATCH', { kind: 'write', target: 'members' }],
    [`${BACKEND}/rest/v1/members`, 'POST', { kind: 'write', target: 'members' }],
    ['https://api.anthropic.com/v1/messages', 'POST', { kind: 'outside', target: 'api.anthropic.com' }],
    ['https://other.example/auth/v1x', 'GET', { kind: 'outside', target: 'other.example' }],
  ] as const)('%s %s', (url, method, expected) => {
    expect(classifyBackendCall(new URL(url), method)).toEqual(expected);
  });

  it('読めない URL は後段でない宛先(相対)', () => {
    expect(classifyBackendCall(null, 'GET')).toEqual({ kind: 'outside', target: 'relative' });
  });
});

describe('gateLeaks(観測の表)', () => {
  const quiet: GateObservation = { status: 401, body: '{"error":"unauthorized"}', thrown: null, calls: [], bodyUsed: false };
  const call = (kind: BackendCall['kind'], target: string): BackendCall => ({ kind, target });

  it.each([
    ['期待どおりに閉じた', quiet, []],
    ['セッションの確かめと行の読み取りは触れてよい', { ...quiet, calls: [call('auth-user', '/auth/v1/user'), call('read', 'members')] }, []],
    ['状態が違う(通った)', { ...quiet, status: 200, body: 'paid' }, ['status:200']],
    ['状態は同じでも本文が関門の語でない', { ...quiet, body: '{"error":"other"}' }, ['body:{"error":"other"}']],
    ['例外で落ちた', { ...quiet, status: null, body: null, thrown: 'boom' }, ['threw:boom']],
    ['枠の RPC を呼んだ', { ...quiet, calls: [call('rpc', 'consume_ai_quota')] }, ['rpc:consume_ai_quota']],
    ['書き込んだ・有料の宛先に触れた・ほかの認証の口', { ...quiet, calls: [call('write', 'members'), call('outside', 'api.anthropic.com'), call('auth-other', '/auth/v1/token')] }, ['write:members', 'outside:api.anthropic.com', 'auth-other:/auth/v1/token']],
    ['本文を読んだ', { ...quiet, bodyUsed: true }, ['body-read']],
  ] as const)('%s', (_title, observation, expected) => {
    expect(gateLeaks(observation, UNAUTHENTICATED_REFUSAL)).toEqual(expected);
  });

  it('403 の閉じ方は forbidden の本文で見る(境界: 401 の本文は 403 では漏れ)', () => {
    const forbidden: GateObservation = { ...quiet, status: 403, body: '{"error":"forbidden"}' };
    expect(gateLeaks(forbidden, FORBIDDEN_REFUSAL)).toEqual([]);
    expect(gateLeaks({ ...forbidden, body: '{"error":"unauthorized"}' }, FORBIDDEN_REFUSAL)).toEqual(['body:{"error":"unauthorized"}']);
    expect(gateLeaks(forbidden, UNAUTHENTICATED_REFUSAL)).toEqual(['status:403']);
  });
});

describe('偽の後段と要求の文脈で、実物の口を叩く', () => {
  it('cookie の値はセッションの adapter が読む形(base64- + base64url(JSON))で、長ければ割る', () => {
    const header = sessionCookieHeader(COOKIE);
    expect(header.startsWith(`${COOKIE}=base64-`)).toBe(true);
    const session = JSON.parse(Buffer.from(header.slice(`${COOKIE}=base64-`.length), 'base64url').toString('utf8')) as { user: { id: string }; expires_at: number };
    expect(session.user.id).toBe(FAKE_SIGNED_IN_USER_ID);
    expect(session.expires_at).toBeGreaterThan(Date.now() / 1000);
    const long = sessionCookieHeader(COOKIE, 'x'.repeat(4000));
    expect(long.split('; ').map((part) => part.slice(0, part.indexOf('=')))).toEqual([`${COOKIE}.0`, `${COOKIE}.1`]);
  });

  it('要求の文脈の中では cookie が読め、外では読めない', async () => {
    backend = installFakeBackend();
    expect(await runInNextRequestContext(sessionCookieHeader(COOKIE), sessionUserId)).toBe(FAKE_SIGNED_IN_USER_ID);
    expect(await runInNextRequestContext('', sessionUserId)).toBeNull();
    await expect(sessionUserId()).rejects.toThrow();
  });

  it('正しい口: 未ログインは 401・役を持たない人(行が 0 本)は 403 で、本文も RPC も有料の宛先も使わない', async () => {
    backend = installFakeBackend();
    expect(gateLeaks(await observeGate(route(), post(), backend, ''), UNAUTHENTICATED_REFUSAL)).toEqual([]);
    const forbidden = await observeGate(route(), post(), backend, sessionCookieHeader(COOKIE));
    expect(gateLeaks(forbidden, FORBIDDEN_REFUSAL)).toEqual([]);
    expect(forbidden.calls.map((call) => call.kind)).toEqual(['auth-user', 'read']);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-009
  it('役を捨てる認可(点検 5 回目 B5-2 の probe4): 未ログインでも通り、本文を読み、枠の RPC と有料の宛先に触れる → 漏れを全部名指す', async () => {
    backend = installFakeBackend();
    const open = route({ authorize: () => Promise.resolve({ kind: 'ok', actorId: 'anyone' }) });
    const leaks = gateLeaks(await observeGate(open, post(), backend, ''), UNAUTHENTICATED_REFUSAL);
    // 有料の宛先は拒まれるので、口は例外で落ちる(落ちたこと自体も漏れの印)。
    expect(leaks).toEqual(['threw:paid-gate: outbound fetch is blocked while observing a gate', 'rpc:consume_quota', 'outside:api.paid.example', 'body-read']);
  });

  it('役を捨てる認可 + meter を呼ばない消費: RPC は 0 回でも、通った・本文を読んだ・有料の宛先に触れたで赤', async () => {
    backend = installFakeBackend();
    const open = route({ authorize: () => Promise.resolve({ kind: 'ok', actorId: 'anyone' }), consume: () => Promise.resolve('used') });
    const leaks = gateLeaks(await observeGate(open, post(), backend, sessionCookieHeader(COOKIE)), FORBIDDEN_REFUSAL);
    expect(leaks).toEqual(['threw:paid-gate: outbound fetch is blocked while observing a gate', 'outside:api.paid.example', 'body-read']);
  });

  it('有料の処理が外へ出ずに 200 を返す口でも、状態と本文の読み取りで赤', async () => {
    backend = installFakeBackend();
    const open = (request: Request): Promise<Response> =>
      runPaidEntry(request, {
        operation: 'answer',
        maxBodyBytes: 1024,
        authorize: () => Promise.resolve({ kind: 'ok', actorId: 'anyone' }),
        bindings: { roleTables: { implications: {} } } as never,
        role: 'member',
        logger: LOGGER,
        parse: (body) => ({ kind: 'ok', value: body }),
        consume: () => Promise.resolve('used'),
        handler: () => Promise.resolve(new Response('paid', { status: 200 })),
      });
    expect(gateLeaks(await observeGate(open, post(), backend, ''), UNAUTHENTICATED_REFUSAL)).toEqual(['status:200', 'body-read']);
  });

  it('dispose は元の fetch に戻し、2 度呼んでも壊れない', () => {
    const current = (): unknown => Reflect.get(globalThis, 'fetch');
    const original = current();
    const fake = installFakeBackend();
    expect(current()).not.toBe(original);
    fake.dispose();
    fake.dispose();
    expect(current()).toBe(original);
  });
});
