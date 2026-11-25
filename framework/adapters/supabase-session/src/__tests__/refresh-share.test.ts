import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@kaninabe/runtime/ports';
import { SESSION_COOKIE_NAME } from '../cookie-policy';
import { createRefreshBudget, unavailableUnlessSignedOut } from '../refresh-guard';
import { JWT_LIFETIME_FLOOR_SECONDS, coalescedRefresh, responseOf, settleBefore, shortLifetimeWarning, untilAborted } from '../refresh-share';
import { createSessionClient, refreshSession } from '../session-client';
import type { AuthOnlyDatabase } from '../session-client';
import { createSessionScope } from '../session-scope';
import type { SessionScope } from '../session-scope';
import { FAKE_AUTH_URL, recordingJar, sessionCookieValue } from './fakes/auth-server';

/**
 * 更新の寄せ(`refresh-share.ts`): 段の中の single-flight・後段の「本当に生きている間は更新しない」・締め切りのあとの答えを捨てる・寿命の警告。
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 更新の口の URL。 */
const TOKEN_URL = 'http://a/auth/v1/token?grant_type=refresh_token';

/** 更新の口の要求。 */
const refreshInit = (token: string, signal?: AbortSignal): RequestInit => ({ method: 'POST', body: JSON.stringify({ refresh_token: token }), ...(signal === undefined ? {} : { signal }) });

/** いまから `seconds` 秒生きるセッションの答えの本文。 */
function sessionBody(refreshToken: string, seconds = 3600): Record<string, unknown> {
  return { access_token: `at-${refreshToken}`, refresh_token: refreshToken, token_type: 'bearer', expires_in: seconds, expires_at: Math.floor(Date.now() / 1000) + seconds, user: { id: 'u' } };
}

/** 呼ばれるたびに次の世代を返す、記録する下の `fetch`。 */
function rotatingBase(seconds = 3600): { readonly fetch: typeof fetch; readonly sent: string[] } {
  const sent: string[] = [];
  let serial = 0;
  const base = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const { refresh_token: token } = JSON.parse(init?.body as string) as { refresh_token: string };
    sent.push(token);
    serial += 1;
    return Promise.resolve(Response.json(sessionBody(`n${String(serial)}`, seconds)));
  }) as typeof fetch;
  return { fetch: base, sent };
}

/** 記録する警告の出口。 */
function recordingLogger(): { readonly records: LogRecord[]; write(record: LogRecord): void } {
  const records: LogRecord[] = [];
  return { records, write: (record) => records.push(record) };
}

/** 要求の cookie(いまから `seconds` 秒生きるセッション。更新トークンは old-refresh-token)。 */
const cookiesAlive = (seconds: number) => () => [{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(seconds) }];

describe('段の中の single-flight(表)', () => {
  /** 1 つの台帳で、続けて 2 回更新したときに下へ出た本数。 */
  async function twice(scope: SessionScope, first: string, second: string, seconds = 3600): Promise<readonly string[]> {
    const base = rotatingBase(seconds);
    const fetchOf = coalescedRefresh(base.fetch, scope, () => []);
    await fetchOf(TOKEN_URL, refreshInit(first));
    await fetchOf(TOKEN_URL, refreshInit(second));
    return base.sent;
  }

  it.each([
    ['同じトークンを 2 回: 2 回目は段のセッションで答える', 'r0', 'r0', ['r0']],
    ['受け取ったトークン(n1)の更新も段のセッションで答える', 'r0', 'n1', ['r0']],
    ['段の知らないトークンは下へ出す', 'r0', 'zz', ['r0', 'zz']],
  ])('%s', async (_name, first, second, expected) => {
    expect(await twice(createSessionScope(), first, second)).toEqual(expected);
  });

  it('段のセッションが切れていたら、古いトークンでなく段のいちばん新しいトークンを更新する(枝を伸ばさない)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const scope = createSessionScope();
    const base = rotatingBase(3);
    const fetchOf = coalescedRefresh(base.fetch, scope, () => []);
    await fetchOf(TOKEN_URL, refreshInit('r0'));
    vi.setSystemTime(1_000_000 + 2_500);
    await fetchOf(TOKEN_URL, refreshInit('r0'));
    expect(base.sent).toEqual(['r0', 'n1']);
    expect(scope.head?.snapshot.refreshToken).toBe('n2');
  });

  it('並んで来た同じトークンの更新は 1 本に寄せ、同じ答えを配る', async () => {
    const scope = createSessionScope();
    let release: (response: Response) => void = () => undefined;
    const base = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (release = resolve)));
    const fetchOf = coalescedRefresh(base, scope, () => []);
    const both = Promise.all([fetchOf(TOKEN_URL, refreshInit('r0')), fetchOf(TOKEN_URL, refreshInit('r0'))]);
    await Promise.resolve();
    release(Response.json(sessionBody('n1')));
    const answers = await Promise.all((await both).map(async (response) => (await response.json()) as { refresh_token: string }));
    expect(base).toHaveBeenCalledTimes(1);
    expect(answers.map((answer) => answer.refresh_token)).toEqual(['n1', 'n1']);
    expect(scope.pending.size).toBe(0);
  });

  it('失敗の答えは段のセッションにならず、そのまま返る', async () => {
    const scope = createSessionScope();
    const fetchOf = coalescedRefresh(() => Promise.resolve(Response.json({ code: 'conflict' }, { status: 409 })), scope, () => []);
    const response = await fetchOf(TOKEN_URL, refreshInit('r0'));
    expect(response.status).toBe(409);
    expect(scope.head).toBeNull();
  });

  it('更新の口でない要求・本文が文字列でない要求・更新トークンの無い本文はそのまま下へ渡す', async () => {
    const base = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    const fetchOf = coalescedRefresh(base, createSessionScope(), () => []);
    await fetchOf('http://a/auth/v1/user', {});
    await fetchOf(TOKEN_URL, { method: 'POST', body: new URLSearchParams('a=1') });
    await fetchOf(TOKEN_URL, { method: 'POST', body: JSON.stringify({ other: 1 }) });
    expect(base).toHaveBeenCalledTimes(3);
  });
});

describe('後段は、要求の cookie が本当に生きている間は更新しない', () => {
  it.each([
    ['後段・生きている(期限の手前 = ライブラリなら前倒しで更新する)', 'downstream', 30, 'old-refresh-token', 0],
    ['後段・切れている', 'downstream', -60, 'old-refresh-token', 1],
    ['後段・余裕(1 秒)の内', 'downstream', 1, 'old-refresh-token', 1],
    ['後段・cookie と違うトークン', 'downstream', 30, 'other', 1],
    ['前段・生きている(前倒しの更新をしてよい)', 'front', 30, 'old-refresh-token', 1],
  ] as const)('%s → 下へ %d 本', async (_name, stage, seconds, token, expected) => {
    const base = rotatingBase();
    const scope = createSessionScope({ stage });
    const fetchOf = coalescedRefresh(base.fetch, scope, cookiesAlive(seconds));
    const response = await fetchOf(TOKEN_URL, refreshInit(token));
    expect(base.sent.length).toBe(expected);
    expect(response.status).toBe(200);
  });

  it('cookie のセッションで答えたあとは世代 0 の先頭になり、同じ要求の続きの読みも下へ出ない', async () => {
    const base = rotatingBase();
    const scope = createSessionScope({ stage: 'downstream' });
    const fetchOf = coalescedRefresh(base.fetch, scope, cookiesAlive(30));
    const first = (await (await fetchOf(TOKEN_URL, refreshInit('old-refresh-token'))).json()) as { refresh_token: string };
    await fetchOf(TOKEN_URL, refreshInit('old-refresh-token'));
    expect(first.refresh_token).toBe('old-refresh-token');
    expect(scope.head?.generation).toBe(0);
    expect(base.sent).toEqual([]);
  });

  it('本物のライブラリで: 後段のクライアントは期限の手前のセッションを更新も書き戻しもしない(前段はする)', async () => {
    const downstream = rotatingBase();
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(30) }]);
    const client = createSessionClient<AuthOnlyDatabase, 'public'>({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: downstream.fetch }, jar);
    await client.auth.getSession();
    expect(downstream.sent).toEqual([]);
    expect(jar.writes).toEqual([]);

    const front = rotatingBase();
    const frontJar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(30) }]);
    await refreshSession({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: front.fetch }, frontJar);
    expect(front.sent).toEqual(['old-refresh-token']);
    expect(frontJar.writes.some((write) => write.value.startsWith('base64-'))).toBe(true);
  });
});

describe('同じ段のクライアントの cookie の書き込み(本物のライブラリ)', () => {
  it('2 本目のクライアントは段のセッションを受け取り、同じ世代の書き込みは書き手に渡らない(1 本目だけが書く)', async () => {
    const base = rotatingBase();
    const scope = createSessionScope({ stage: 'front' });
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    for (let client = 0; client < 2; client += 1) {
      await createSessionClient<AuthOnlyDatabase, 'public'>({ url: FAKE_AUTH_URL, anonKey: 'anon', fetch: base.fetch }, jar, { scope }).auth.getSession();
    }
    expect(base.sent).toEqual(['old-refresh-token']);
    expect(jar.headers.length).toBe(1);
    expect(scope.written).toBe(1);
  });
});

describe('締め切りのあとに着いた答えは捨てる(cookie にならない)', () => {
  it('信号を無視して遅れて答える下の `fetch` でも、締め切りのあとの答えは null', async () => {
    const deadline = new AbortController();
    const late = settleBefore(
      () =>
        new Promise<Response>((resolve) => {
          deadline.signal.addEventListener('abort', () => {
            resolve(Response.json(sessionBody('late')));
          });
        }),
      TOKEN_URL,
      refreshInit('r0'),
      deadline.signal,
    );
    deadline.abort();
    expect(await late).toBeNull();
  });

  it.each([
    ['通信の失敗', () => Promise.reject(new TypeError('fetch failed'))],
    ['本文を読めない', () => Promise.resolve({ status: 200, headers: new Headers(), text: () => Promise.reject(new Error('reset')) } as unknown as Response)],
  ])('%s は null', async (_name, base) => {
    expect(await settleBefore(base as typeof fetch, TOKEN_URL, refreshInit('r0'), new AbortController().signal)).toBeNull();
  });

  it('締め切りの前に着いた答えは読み切って返す', async () => {
    const outcome = await settleBefore(() => Promise.resolve(Response.json({ a: 1 }, { status: 201 })), TOKEN_URL, refreshInit('r0'), new AbortController().signal);
    expect(outcome).toMatchObject({ status: 201, body: '{"a":1}' });
  });

  it('待つ側は自分の締め切りで抜け、段の答えは段に残る(同じ段の次の呼び手は待たずに受け取る)', async () => {
    const scope = createSessionScope();
    let release: (response: Response) => void = () => undefined;
    const base = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (release = resolve)));
    const fetchOf = coalescedRefresh(base, scope, () => []);
    const caller = new AbortController();
    const abandoned = fetchOf(TOKEN_URL, refreshInit('r0', caller.signal));
    caller.abort();
    await expect(abandoned).rejects.toThrow('fetch failed');
    const waiting = fetchOf(TOKEN_URL, refreshInit('r0'));
    release(Response.json(sessionBody('n1')));
    expect(((await (await waiting).json()) as { refresh_token: string }).refresh_token).toBe('n1');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('前段の守りの下で: 締め切りのあとの答えは失敗として数え、cookie を書かない', async () => {
    const jar = recordingJar([{ name: SESSION_COOKIE_NAME, value: sessionCookieValue(-60) }]);
    const outer = new AbortController();
    outer.abort();
    const guarded = unavailableUnlessSignedOut(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          if (init?.signal?.aborted === true) resolve(Response.json(sessionBody('late')));
        }),
      createRefreshBudget(),
    );
    const response = await guarded(TOKEN_URL, refreshInit('r0', outer.signal));
    expect(response.status).toBe(503);
    expect(jar.writes).toEqual([]);
  });

  it.each([
    ['信号なし', undefined, 'v'],
    ['抜けていない信号', new AbortController().signal, 'v'],
  ])('untilAborted: %s なら答えを待つ', async (_name, signal, expected) => {
    expect(await untilAborted(Promise.resolve('v'), signal)).toBe(expected);
  });

  it('untilAborted: 先に抜けた信号は null', async () => {
    expect(await untilAborted(Promise.resolve('v'), AbortSignal.abort())).toBeNull();
  });
});

describe('responseOf(呼び手ごとに作り直す応答)', () => {
  it.each([
    ['JSON の本文', 200, '{"a":1}', 'application/json; charset=utf-8', '{"a":1}'],
    ['JSON でない本文', 502, '<html>', 'text/plain; charset=utf-8', '<html>'],
    ['本文を持てない状態', 204, '', null, ''],
  ])('%s', async (_name, status, body, contentType, text) => {
    const response = responseOf({ status, headers: [['x-supabase-api-version', '2024-01-01'], ['content-length', '7'], ['content-encoding', 'gzip']], body });
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe(contentType);
    expect(response.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(text);
  });
});

describe('寿命の警告(ライブラリの更新の余裕 90 秒以下)', () => {
  it.each([
    ['3 秒(測り)', 3, true],
    ['ちょうど 90 秒', JWT_LIFETIME_FLOOR_SECONDS, true],
    ['91 秒', JWT_LIFETIME_FLOOR_SECONDS + 1, false],
    ['3600 秒(製品)', 3600, false],
    ['寿命が無い', undefined, false],
  ])('%s → 警告 %s', (_name, seconds, expected) => {
    expect(shortLifetimeWarning(JSON.stringify({ expires_in: seconds })) !== null).toBe(expected);
  });

  it('前段だけが、成功の答えで警告を出す(後段・失敗は出さない)', async () => {
    const cases = [
      { stage: 'front', status: 200, warned: 1 },
      { stage: 'downstream', status: 200, warned: 0 },
      { stage: 'front', status: 400, warned: 0 },
    ] as const;
    for (const { stage, status, warned } of cases) {
      const logger = recordingLogger();
      const fetchOf = coalescedRefresh(() => Promise.resolve(Response.json(sessionBody('n1', 3), { status })), createSessionScope({ stage }), () => [], logger);
      await fetchOf(TOKEN_URL, refreshInit('r0'));
      expect(logger.records.filter((record) => record.level === 'warn').length).toBe(warned);
    }
  });

  it('出口の既定は標準出力の 1 行 JSON', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchOf = coalescedRefresh(() => Promise.resolve(Response.json(sessionBody('n1', 3))), createSessionScope(), () => []);
    await fetchOf(TOKEN_URL, refreshInit('r0'));
    expect(info.mock.calls.some(([line]) => typeof line === 'string' && line.includes('"level":"warn"'))).toBe(true);
  });
});
