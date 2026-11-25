import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieWrite } from '../cookie-policy';
import { SESSION_COOKIE_NAME } from '../cookie-policy';
import { createSessionClient, refreshSession, signedInUserOf } from '../session-client';
import type { AuthOnlyDatabase, CookieJar, RequestCookie, SessionClientOptions } from '../session-client';
import { createSessionScope } from '../session-scope';
import { ROTATING_AUTH_URL, createRotatingAuthServer } from './fakes/rotating-auth-server';
import type { RotatingAuthServer } from './fakes/rotating-auth-server';

/**
 * **締め出しの連鎖の再現**(決定的。点検 17〜19 回目の測り `JWT_EXP=3`・10 並列で 50 回中 6 回 → 12 件とも同じ形)。
 *
 * 1. 要求 A の前段が更新して 1 世代進めた cookie を応答に載せる。A の描画(後段)が、その cookie を同じ要求の中でさらに回す
 *    (アクセストークンの寿命 3 秒 < ライブラリの余裕 90 秒。描画は cookie を書けないので、回した世代はどこにも残らない)。
 * 2. 並列の要求 C の応答が先に着き、ブラウザは**新しい** cookie を持つ。
 * 3. A の応答が再利用の猶予(10 秒)より遅れて着き、**古い** cookie で上書きする(最後に着いた書き込みが勝つ)。
 * 4. 次の要求 B は `refresh_token_already_used` になり、認証基盤はセッションの系列を失効させる → 締め出し。
 *
 * 前段と後段は製品の配線と同じ形で組む(前段 = `refreshSession` に、要求の cookie を書き換えて後段へ渡す書き手。後段 = 書けない書き手の
 * `createSessionClient` を 2 本・それぞれ 2 回読む)。A と C/B は別の実体(サーバーレスの別のプロセス)の `fetch` を使う。
 * 直しの前のコード(5fbd96667 の adapter)では 2 本が赤(締め出しと 11 回の更新)、直しの後は緑。
 */

/** ブラウザの cookie の入れ物(応答の `Set-Cookie` を着いた順に当てる)。 */
class Browser {
  readonly cookies = new Map<string, string>();

  /** 応答の書き込みを当てる。 */
  apply(writes: readonly CookieWrite[]): void {
    for (const write of writes) {
      if (write.value === '' || write.options.maxAge === 0) this.cookies.delete(write.name);
      else this.cookies.set(write.name, write.value);
    }
  }

  /** 要求に載せる cookie。 */
  send(): RequestCookie[] {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }

  /** セッションの cookie を持っているか。 */
  signedIn(): boolean {
    return [...this.cookies.keys()].some((name) => name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`));
  }
}

/** 前段の結果: 応答に載せる書き込みと、後段へ渡す要求の cookie。 */
interface FrontResult {
  readonly responseWrites: CookieWrite[];
  readonly forwarded: RequestCookie[];
}

/** 要求の前段(製品の `proxy-session.ts` と同じ形: 書き込みを応答に積み、要求の cookie も書き換える)。 */
async function frontStage(fetchOf: typeof fetch, sent: readonly RequestCookie[]): Promise<FrontResult> {
  const request = new Map(sent.map(({ name, value }) => [name, value]));
  const responseWrites: CookieWrite[] = [];
  const jar: CookieJar = {
    getAll: () => [...request].map(([name, value]) => ({ name, value })),
    setAll: (writes) => {
      for (const { name, value, options } of writes) {
        if (options.maxAge === 0) request.delete(name);
        else request.set(name, value);
      }
      responseWrites.push(...writes);
    },
  };
  await refreshSession({ url: ROTATING_AUTH_URL, anonKey: 'anon', fetch: fetchOf }, jar);
  return { responseWrites, forwarded: [...request].map(([name, value]) => ({ name, value })) };
}

/**
 * 要求の後段(描画。cookie を書けない)。クライアント 2 本が、それぞれ 2 回セッションを読む。最後の読みの利用者を返す。
 * `options` は変異の確かめだけが渡す(省略 = 製品の配線と同じ既定)。
 */
async function downstreamStage(fetchOf: typeof fetch, forwarded: readonly RequestCookie[], options: () => SessionClientOptions<'public'> = () => ({})): Promise<unknown> {
  const readOnly: CookieJar = { getAll: () => forwarded, setAll: () => undefined };
  let last: unknown = null;
  for (let client = 0; client < 2; client += 1) {
    const session = createSessionClient<AuthOnlyDatabase, 'public'>({ url: ROTATING_AUTH_URL, anonKey: 'anon', fetch: fetchOf }, readOnly, options());
    for (let read = 0; read < 2; read += 1) last = signedInUserOf(await session.auth.getUser());
  }
  return last;
}

const T0 = new Date('2026-11-05T00:00:00Z').getTime();

/** 偽の時計をいまから `ms` ミリ秒の位置へ。 */
function at(ms: number): void {
  vi.setSystemTime(T0 + ms);
}

describe('締め出しの連鎖(遅れて着いた古い cookie が新しい cookie を上書きする)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 連鎖を 1 回通す。 */
  async function chain(server: RotatingAuthServer, downstreamOptions?: () => SessionClientOptions<'public'>): Promise<{ readonly browser: Browser; readonly user: unknown }> {
    const instanceA = server.instance();
    const instanceB = server.instance();
    const browser = new Browser();
    browser.apply([{ name: SESSION_COOKIE_NAME, value: server.initialCookieValue(-60), options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } }]);

    // 要求 A(遅い): 前段で 1 世代進め、描画が読む。
    const sentA = browser.send();
    const frontA = await frontStage(instanceA, sentA);
    at(500);
    await downstreamStage(instanceA, frontA.forwarded, downstreamOptions);

    // 要求 C(並列・速い): 同じ古い cookie で始まり、先に着く。
    at(1_000);
    const frontC = await frontStage(instanceB, sentA);
    at(1_200);
    await downstreamStage(instanceB, frontC.forwarded, downstreamOptions);
    at(2_000);
    browser.apply(frontC.responseWrites);

    // A の応答が、再利用の猶予(10 秒)より遅れて着く(測りでは 504 の 10 秒待ちの後、11〜15 秒)。
    at(13_000);
    browser.apply(frontA.responseWrites);

    // 次の要求 B。
    at(13_100);
    const frontB = await frontStage(instanceB, browser.send());
    browser.apply(frontB.responseWrites);
    const user = await downstreamStage(instanceB, frontB.forwarded);
    return { browser, user };
  }

  it('JWT_EXP=3: 遅れて着いた応答のあとも、次の要求は締め出されない(認証基盤の系列も生きている)', async () => {
    const server = createRotatingAuthServer({ jwtExpSeconds: 3 });
    const { browser, user } = await chain(server);
    expect(server.log.filter((entry) => entry.code === 'refresh_token_already_used')).toEqual([]);
    expect(server.familyRevoked()).toBe(false);
    expect(browser.signedIn()).toBe(true);
    expect(user).not.toBeNull();
  });

  it('JWT_EXP=3: 1 要求の更新は前段の 1 回だけ(描画は回さない)。並列の C は認証基盤の規則で A と同じ世代に収まる', async () => {
    const server = createRotatingAuthServer({ jwtExpSeconds: 3 });
    await chain(server);
    // A の前段・C の前段(A の子を返す)・B の前段 の 3 回。描画の更新は 0 回。
    expect(server.log.map((entry) => [entry.in, entry.out])).toEqual([
      ['rt-1', 'rt-2'],
      ['rt-1', 'rt-2'],
      ['rt-2', 'rt-3'],
    ]);
  });

  it('変異: 後段の規則を外す(描画のクライアントを前段の台帳にする = 期限の手前で回す)と、同じ流れで締め出しが戻る(このテストが規則を見ている証拠)', async () => {
    const server = createRotatingAuthServer({ jwtExpSeconds: 3 });
    await chain(server, () => ({ scope: createSessionScope({ stage: 'front' }) }));
    expect(server.log.some((entry) => entry.code === 'refresh_token_already_used')).toBe(true);
    expect(server.familyRevoked()).toBe(true);
  });

  it('対照: 製品の寿命(3600 秒)でも同じ流れで締め出されない', async () => {
    const server = createRotatingAuthServer({ jwtExpSeconds: 3600 });
    const { browser, user } = await chain(server);
    expect(server.familyRevoked()).toBe(false);
    expect(browser.signedIn()).toBe(true);
    expect(user).not.toBeNull();
  });
});
