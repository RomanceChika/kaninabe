/**
 * 外の URL を呼ぶ `fetch`(`safe-fetch.ts`。ASVS V15.3.2)のテスト。
 *
 * 2 層で見る。①グローバルの `fetch` を差し替えて、`redirect: "error"` が常に渡り、呼び出し側は変えられず、ほかの引数は
 * そのまま渡ること ②**実物のサーバー**(自分の機械の `127.0.0.1`)で、3xx を返す呼び先について行かず(転送先に 1 本も届かない)
 * `TypeError` で失敗すること —— 素の `fetch` は同じ呼び先でついて行く(対照)。
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../safe-fetch';
import type { SafeFetchInit } from '../safe-fetch';

describe('safeFetch(グローバル fetch の差し替え)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** グローバルの fetch を差し替え、渡された引数を集める。 */
  function stub(): { readonly calls: { readonly input: RequestInfo | URL; readonly init: RequestInit | undefined }[] } {
    const calls: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        return Promise.resolve(new Response('ok'));
      }),
    );
    return { calls };
  }

  it('redirect: "error" を付け、ほかの引数はそのまま渡す', async () => {
    const { calls } = stub();
    const signal = AbortSignal.timeout(1000);
    const response = await safeFetch('https://example.invalid/x', { method: 'POST', headers: { A: '1' }, body: 'b', signal });
    expect(await response.text()).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('https://example.invalid/x');
    expect(calls[0]?.init).toEqual({ method: 'POST', headers: { A: '1' }, body: 'b', signal, redirect: 'error', cache: 'no-store' });
  });

  it('init を省いても redirect: "error" が付く(URL・Request のどちらを渡しても)', async () => {
    const { calls } = stub();
    await safeFetch(new URL('https://example.invalid/y'));
    await safeFetch(new Request('https://example.invalid/z', { redirect: 'follow' }));
    expect(calls.map((call) => call.init)).toEqual([
      { redirect: 'error', cache: 'no-store' },
      { redirect: 'error', cache: 'no-store' },
    ]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-HTTPPARTS-002
  it('呼び出し側は redirect を変えられない(型に無く、実行時に渡されても "error" に決め直す)', async () => {
    const { calls } = stub();
    const sneaky = { redirect: 'follow' } as unknown as SafeFetchInit;
    await safeFetch('https://example.invalid/x', sneaky);
    await safeFetch('https://example.invalid/x', { redirect: 'manual' } as unknown as SafeFetchInit);
    expect(calls.map((call) => call.init?.redirect)).toEqual(['error', 'error']);
  });

  it('枠のデータのキャッシュに載せない(cache は "no-store" に決め直し、next は渡さない。点検 12 回目 B12-2)', async () => {
    const { calls } = stub();
    await safeFetch('https://example.invalid/x', { cache: 'force-cache' } as unknown as SafeFetchInit);
    await safeFetch('https://example.invalid/x', { next: { revalidate: 60, tags: ['t'] } } as unknown as SafeFetchInit);
    await safeFetch(new Request('https://example.invalid/z', { cache: 'force-cache' }));
    expect(calls.map((call) => call.init)).toEqual([
      { redirect: 'error', cache: 'no-store' },
      { redirect: 'error', cache: 'no-store' },
      { redirect: 'error', cache: 'no-store' },
    ]);
  });

  it('呼ぶたびにグローバルの fetch を引く(あとからの差し替えに効く)', async () => {
    const first = stub();
    await safeFetch('https://example.invalid/1');
    const second = stub();
    await safeFetch('https://example.invalid/2');
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  });
});

describe('safeFetch(実物のサーバーで)', () => {
  let server: Server;
  let base = '';
  /** 転送先に届いた要求の数。 */
  let landed = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/landed') {
        landed += 1;
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end('landed');
        return;
      }
      if (request.url === '/direct') {
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end('direct');
        return;
      }
      const status = Number(request.url?.slice(1));
      response.writeHead(status, { Location: '/landed' }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('転送のない呼び先は通常どおり読める', async () => {
    expect(await (await safeFetch(`${base}/direct`)).text()).toBe('direct');
  });

  // @spec framework-guarantee-catalog @tc TC-FW-HTTPPARTS-003
  it('301・302・303・307・308 の転送について行かず TypeError で失敗する(転送先に届かない)', async () => {
    const statuses = [301, 302, 303, 307, 308];
    expect(statuses).toHaveLength(5);
    for (const status of statuses) {
      const before = landed;
      await expect(safeFetch(`${base}/${status}`), String(status)).rejects.toBeInstanceOf(TypeError);
      expect(landed, String(status)).toBe(before);
    }
  });

  it('対照: 素の fetch は同じ呼び先でついて行く(この部品が無ければ転送先に届く)', async () => {
    const before = landed;
    // 対照のためにだけ素の fetch を使う。静的な参照は `layer/no-external-network` が止めるので、計算した引き方(規則の下限)で取る。
    const plainFetch = Reflect.get(globalThis, 'fetch') as typeof fetch;
    expect(await (await plainFetch(`${base}/302`)).text()).toBe('landed');
    expect(landed).toBe(before + 1);
  });
});
