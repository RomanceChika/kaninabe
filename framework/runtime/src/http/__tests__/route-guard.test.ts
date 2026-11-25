/**
 * Route Handler の出口の関所(`route-guard.ts`。ASVS V3.7.2。点検 10 回目 B10-1)のテスト。
 *
 * 確かめるのは 4 つ —— ①口が返した応答の `Location` は、綴り(大文字小文字・組み方)に関係なく、同じオリジンの相対パスか宣言した外の
 * オリジンだけが通り、ほかは行き先の無い 500(cookie も本文も捨てる)とログ 1 行になる ②`Refresh` は値に関係なく止まる
 * ③口が投げた転送の合図(`NEXT_REDIRECT`)も同じ判定を通る(通るものは投げ直し、合図でない例外はそのまま) ④包んだ口だけが包まれていると答える。
 * 表の行には点検 10 回目 B の探りの形(小文字の鍵を変数に組む・`headers` を別名に取って `.set`・表への代入・cookie つきの生の 303)を入れる。
 * ⑤`Content-Type` の閉じた表(点検 11 回目 B11-3)。
 *
 * @oversize 1 つの関所の判定の表(行き先・合図・型・宣言)を、同じ要求と出力口で回す。
 * @split-review 型の表を別ファイルに分けられるが、関所の 1 回の応答の順序(行き先の次に型)を同じ場所で見たいので 1 本のままにした。
 */

import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '../../operation/ports';
import { attachmentResponse } from '../response';
import { ATTACHMENT_RESPONSE_TYPES, cacheHeadersAllowed, contentTypeAllowed, guardRoute, isExactOrigin, isGuardedRoute, locationAllowed, redirectHeadersVerdict, redirectSignalTarget, ROUTE_GUARD_REFUSAL_STATUS, ROUTE_RESPONSE_HEADERS } from '../route-guard';

/** 書いた行を貯める出力口。 */
function memoryLogger(): { readonly records: LogRecord[]; readonly logger: { write: (record: LogRecord) => void } } {
  const records: LogRecord[] = [];
  return { records, logger: { write: (record) => records.push(record) } };
}

/** 表の外の見出し(キャッシュの指示として読まれるもの・読まれるか判断していないもの)。 */
const UNLISTED_HEADERS = ['cdn-cache-control', 'vercel-cdn-cache-control', 'cloudflare-cdn-cache-control', 'surrogate-control', 'Edge-Control', 'X-Accel-Expires', 'Age', 'Vary', 'X-Anything'];

/** 要求(要求の識別子つき)。 */
const request = (): Request => new Request('https://app.example/api/x', { headers: { 'x-request-id': 'req-1' } });

/** 外の行き先の表(認証基盤の接続先の形)。 */
const IDP = 'https://auth.example';

/** 口が返す応答を組む形(探りの形を含む)と、関所の判定。 */
const RESPONSES: readonly (readonly [string, () => Response, 'pass' | 'block'])[] = [
  ['相対パスの Location', () => new Response(null, { status: 303, headers: { Location: '/login' } }), 'pass'],
  ['クエリとフラグメントつきの相対パス', () => new Response(null, { status: 303, headers: { location: '/items/a?tab=x#y' } }), 'pass'],
  ['Location の無い応答', () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), 'pass'],
  ['201 の相対の Location(作った資源)', () => new Response(null, { status: 201, headers: { Location: '/items/1' } }), 'pass'],
  ['外の URL(大文字の鍵)', () => new Response(null, { status: 303, headers: { Location: 'https://evil.example/login' } }), 'block'],
  ['探り①: 小文字の鍵を変数のオブジェクトに組む', () => {
    const headers: Record<string, string> = { 'cache-control': 'no-store', location: 'https://evil.example/login' };
    return new Response(null, { status: 303, headers });
  }, 'block'],
  ['探り②: headers を別名に取って set', () => {
    const response = new Response(null, { status: 303 });
    const h = response.headers;
    h.set('Location', 'https://evil.example/login');
    return response;
  }, 'block'],
  ['探り③: 見出しの表へ代入', () => {
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    headers['Location'] = 'https://evil.example/login';
    return new Response(null, { status: 303, headers });
  }, 'block'],
  ['探り B10-2: cookie つきの生の 303(Set-Cookie も外へ出さない)', () => {
    const response = new Response(null, { status: 303, headers: { 'Cache-Control': 'no-store', Location: 'https://evil.example/login' } });
    response.headers.append('Set-Cookie', '__Host-x=; Max-Age=0; Path=/; Secure');
    return response;
  }, 'block'],
  ['大文字小文字を混ぜた鍵', () => new Response(null, { status: 302, headers: { LoCaTiOn: '//evil.example' } }), 'block'],
  ['/\\ で始まる', () => new Response(null, { status: 303, headers: { Location: '/\\evil.example' } }), 'block'],
  ['正規化で // に畳まれる綴り', () => new Response(null, { status: 303, headers: { Location: '/.//evil.example' } }), 'block'],
  ['スキームの javascript:', () => new Response(null, { status: 303, headers: { Location: 'javascript:alert(1)' } }), 'block'],
  ['相対の参照(/ で始まらない)', () => new Response(null, { status: 303, headers: { Location: 'evil.example' } }), 'block'],
  ['空の Location', () => new Response(null, { status: 303, headers: { Location: '' } }), 'block'],
  ['同じオリジンでも絶対 URL(相対パスだけを通す)', () => new Response(null, { status: 303, headers: { Location: 'https://app.example/login' } }), 'block'],
  ['宣言していない外の IdP', () => new Response(null, { status: 303, headers: { Location: `${IDP}/authorize` } }), 'block'],
  ['Refresh(url つき)', () => new Response('', { status: 200, headers: { Refresh: '0; url=https://evil.example' } }), 'block'],
  ['Refresh(相対でも・url なしでも止める)', () => new Response('', { status: 200, headers: { refresh: '5' } }), 'block'],
];

/** Content-Type の閉じた表(点検 11 回目 B11-3)の行: 名前・応答・判定。 */
const TYPED_RESPONSES: readonly (readonly [string, () => Response, 'pass' | 'block'])[] = [
  ['jsonResponse の型', () => new Response('{}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } }), 'pass'],
  ['textResponse の型', () => new Response('x', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), 'pass'],
  ['Response.json の型(charset なし)', () => Response.json({}), 'pass'],
  ['文字列の本文の既定の型', () => new Response('x'), 'pass'],
  ['大文字の型', () => new Response('x', { headers: { 'Content-Type': 'TEXT/PLAIN;CHARSET=UTF-8' } }), 'pass'],
  ['本文の無い 204', () => new Response(null, { status: 204 }), 'pass'],
  ['本文の無い転送', () => new Response(null, { status: 303, headers: { Location: '/login' } }), 'pass'],
  ['探り: 反射の中継ページ', () => new Response('<!doctype html><script>alert(1)</script>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }), 'block'],
  ['小文字の鍵を変数に組んだ text/html', () => {
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    return new Response('<p>x</p>', { headers });
  }, 'block'],
  ['見出しを後から書く text/html', () => {
    const response = new Response('<p>x</p>');
    response.headers.set('content-type', 'TEXT/HTML');
    return response;
  }, 'block'],
  ['本文の無い text/html(型だけで止める)', () => new Response(null, { headers: { 'Content-Type': 'text/html' } }), 'block'],
  ['application/xhtml+xml', () => new Response('<x/>', { headers: { 'Content-Type': 'application/xhtml+xml; charset=utf-8' } }), 'block'],
  ['image/svg+xml', () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }), 'block'],
  ['Blob の型が付く text/html', () => new Response(new Blob(['<p>x</p>'], { type: 'text/html' })), 'block'],
  ['2 本の畳み込み(ブラウザは後ろの型を読む)', () => {
    const response = new Response('<p>x</p>', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    response.headers.append('Content-Type', 'text/html');
    return response;
  }, 'block'],
  ['charset 以外の付加情報', () => new Response('x', { headers: { 'Content-Type': 'text/plain; x=y' } }), 'block'],
  ['本文があるのに型が無いストリーム', () => new Response(new ReadableStream({ start: (controller) => controller.close() })), 'block'],
  ['宣言の無いダウンロード', () => new Response('a,b', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment' } }), 'block'],
];

describe('guardRoute(Content-Type の閉じた表。点検 11 回目 B11-3)', () => {
  it.each(TYPED_RESPONSES)('%s', async (name, make, expected) => {
    const memory = memoryLogger();
    const original = make();
    const response = await guardRoute(() => original, { logger: memory.logger })(request());
    if (expected === 'pass') {
      expect(response).toBe(original);
      expect(memory.records).toEqual([]);
      return;
    }
    expect(response.status, name).toBe(ROUTE_GUARD_REFUSAL_STATUS);
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(memory.records).toEqual([{ level: 'warn', security_event: 'response_type_refused', refusal_code: 'unsafe_content_type', request_id: 'req-1' }]);
  });

  /** 宣言の 1 行。 */
  const CSV = [{ type: 'text/csv', reason: '帳票の出力' }];

  it.each([
    ['宣言した型の attachment', 'text/csv; charset=utf-8', 'attachment; filename="a.csv"', CSV, true],
    ['宣言した型でも inline は止める', 'text/csv', 'inline', CSV, false],
    ['宣言した型でも Content-Disposition が無ければ止める', 'text/csv', null, CSV, false],
    ['別の型の宣言では止める', 'application/pdf', 'attachment', CSV, false],
    ['表の外の型は宣言しても止める(text/html)', 'text/html', 'attachment', [{ type: 'text/html', reason: '中継ページ' }], false],
    ['表の外の型は宣言しても止める(svg)', 'image/svg+xml', 'attachment', [{ type: 'image/svg+xml', reason: '図' }], false],
    ['理由が空の宣言は止める', 'text/csv', 'attachment', [{ type: 'text/csv', reason: ' ' }], false],
  ])('ダウンロードの宣言: %s', (_name, type, disposition, declared, expected) => {
    const headers = new Headers({ 'Content-Type': type });
    if (disposition !== null) headers.set('Content-Disposition', disposition);
    expect(contentTypeAllowed(new Response('x', { headers }), declared)).toBe(expected);
  });

  it('ダウンロードの表はブラウザが実行する型を持たない', () => {
    expect(ATTACHMENT_RESPONSE_TYPES.filter((type) => /html|xml|svg|script/u.test(type))).toEqual([]);
  });

  it('attachmentResponse は宣言した口の関所を通り、宣言の無い口では止まる', async () => {
    const make = (): Response => attachmentResponse('a,b', 'text/csv; charset=utf-8', { headers: { 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' } });
    expect(make().headers.get('content-disposition')).toBe('attachment');
    expect(make().headers.get('cache-control')).toBe('no-store');
    expect((await guardRoute(make, { attachmentTypes: CSV })(request())).status).toBe(200);
    expect((await guardRoute(make, { logger: memoryLogger().logger })(request())).status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
  });
});

describe('guardRoute(キャッシュの見出しの閉じた表。点検 12 回目 B12-4)', () => {
  /**
   * 見出しを付けた JSON の応答を関所に通す。
   *
   * @param headers - 足す見出し
   * @returns 外へ出る応答と書いたログ
   */
  async function through(headers: Record<string, string>): Promise<{ response: Response; records: LogRecord[] }> {
    const records: LogRecord[] = [];
    const handler = guardRoute(() => new Response('{}', { headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } }), {
      logger: { write: (record) => records.push(record) },
    });
    return { response: await handler(new Request('https://app.example/api/x')), records };
  }

  it.each([
    ['共有の保存', 'public, s-maxage=600'],
    ['public だけ', 'public'],
    ['max-age', 'max-age=60'],
    ['private', 'private'],
    ['no-cache', 'no-cache'],
    ['2 本の畳み込み', 'no-store, public'],
    ['stale-while-revalidate', 's-maxage=1, stale-while-revalidate=59'],
  ])('%s の Cache-Control は行き先の無い 500 にする', async (_label, value) => {
    const { response, records } = await through({ 'Cache-Control': value });
    expect(response.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(records).toEqual([expect.objectContaining({ security_event: 'response_cache_refused', refusal_code: 'unsafe_cache_control' })]);
  });

  it.each(UNLISTED_HEADERS.map((name) => [name]))('表の外の %s は値に関係なく止める(点検 13 回目 B13-6 の Expires・Edge-Control・X-Accel-Expires を含む)', async (name) => {
    const { response } = await through({ [name]: 'no-store' });
    expect(response.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
  });

  it.each([
    ['no-store', { 'Cache-Control': 'no-store' }],
    ['大文字の綴り', { 'Cache-Control': 'No-Store' }],
    ['見出しなし', {}],
  ])('%s は通す', async (_label, headers) => {
    const { response, records } = await through(headers);
    expect(response.status).toBe(200);
    expect(records).toEqual([]);
  });

  it('判定の純関数', () => {
    expect(cacheHeadersAllowed(new Headers())).toBe(true);
    expect(cacheHeadersAllowed(new Headers({ 'Cache-Control': ' no-store ' }))).toBe(true);
    expect(cacheHeadersAllowed(new Headers({ 'Cache-Control': 's-maxage=1' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ 'Vercel-CDN-Cache-Control': 'max-age=1' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ Expires: 'Thu, 01 Jan 2099 00:00:00 GMT' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ 'Edge-Control': 'public, max-age=600' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ 'X-Accel-Expires': '600' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ Expires: '0', Pragma: 'no-cache' }))).toBe(true);
    expect(cacheHeadersAllowed(new Headers({ Expires: '600' }))).toBe(false);
    expect(cacheHeadersAllowed(new Headers({ Pragma: 'public' }))).toBe(false);
    for (const name of ROUTE_RESPONSE_HEADERS) expect(cacheHeadersAllowed(new Headers({ [name]: 'no-store' })), name).toBe(true);
  });
});

describe('guardRoute(口の応答)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SAFEREDIRECT-004
  it('口が返した応答の Location が同じオリジンの相対パスでなければ、行き先の無い 500 にしてログを 1 行書く(綴りを問わない)', async () => {
    expect(RESPONSES.length).toBeGreaterThan(0);
    for (const [name, make, expected] of RESPONSES) {
      const memory = memoryLogger();
      const original = make();
      const response = await guardRoute(() => original, { logger: memory.logger })(request());
      if (expected === 'pass') {
        expect(response, name).toBe(original);
        expect(memory.records, name).toEqual([]);
        continue;
      }
      expect(response.status, name).toBe(ROUTE_GUARD_REFUSAL_STATUS);
      expect(response.headers.get('location'), name).toBeNull();
      expect(response.headers.get('refresh'), name).toBeNull();
      expect(response.headers.get('set-cookie'), name).toBeNull();
      expect(response.headers.get('cache-control'), name).toBe('no-store');
      expect(await response.text(), name).toBe('');
      expect(memory.records, name).toHaveLength(1);
      const record = memory.records[0];
      expect(record?.security_event, name).toBe('redirect_refused');
      expect(record?.request_id, name).toBe('req-1');
      expect(JSON.stringify(record), name).not.toContain('evil');
    }
  });

  it.each([
    ['宣言した外のオリジンへの絶対 URL は通す', `${IDP}/auth/v1/authorize?provider=x`, 'pass'],
    ['宣言した外のオリジンの別のポートは止める', 'https://auth.example:8443/authorize', 'block'],
    ['宣言した外のオリジンの別のスキームは止める', 'http://auth.example/authorize', 'block'],
    ['宣言した外のオリジンの下位のホストは止める', 'https://sub.auth.example/authorize', 'block'],
    ['userinfo で宣言したオリジンに見せる綴りは止める', 'https://auth.example@evil.example/', 'block'],
    ['相対パスは外の表があっても通す', '/login?error=start_failed', 'pass'],
  ])('外の行き先の表: %s', async (_name, location, expected) => {
    const memory = memoryLogger();
    const handler = guardRoute(() => new Response(null, { status: 303, headers: { Location: location } }), { externalOrigins: () => [IDP], logger: memory.logger });
    const response = await handler(request());
    expect(response.status).toBe(expected === 'pass' ? 303 : ROUTE_GUARD_REFUSAL_STATUS);
    expect(memory.records).toHaveLength(expected === 'pass' ? 0 : 1);
  });

  it.each([['https://auth.example/'], ['https://auth.example/path'], ['auth.example'], ['javascript:alert(1)'], ['']])('外の行き先の表に完全なオリジンでない行(%s)があれば、表を読む応答で例外(外へは出さない)', async (origin) => {
    const handler = guardRoute(() => new Response(null, { status: 303, headers: { Location: 'https://auth.example/authorize' } }), { externalOrigins: () => [origin] });
    await expect(handler(request())).rejects.toThrow(/完全なオリジン/u);
  });

  it('外の行き先の表は、相対パスでない Location を持つ応答のときだけ 1 回読む(拒否・相対の転送・転送の無い応答では設定に触れない)', async () => {
    let reads = 0;
    const externalOrigins = (): readonly string[] => {
      reads += 1;
      return [IDP];
    };
    for (const make of [() => new Response(null, { status: 403 }), () => new Response(null, { status: 303, headers: { Location: '/login' } }), () => new Response('{}')]) {
      await guardRoute(make, { externalOrigins })(request());
    }
    expect(reads).toBe(0);
    const idp = await guardRoute(() => new Response(null, { status: 303, headers: { Location: `${IDP}/a` } }), { externalOrigins })(request());
    expect(idp.status).toBe(303);
    expect(reads).toBe(1);
    // 2 本の Location は 1 つの値に畳まれ(`a, b`)、URL の文法に合わないので表を読まずに止まる。
    const doubled = await guardRoute(() => {
      const response = new Response(null, { status: 303, headers: { Location: `${IDP}/a` } });
      response.headers.append('Location', 'https://evil.example/b');
      return response;
    }, { externalOrigins })(request());
    expect(doubled.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
  });

  it('出力口を省いたら標準出力に 1 行書く', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((line: string) => {
      lines.push(line);
    });
    try {
      const response = await guardRoute(() => new Response(null, { status: 303, headers: { Location: 'https://evil.example' } }))(request());
      expect(response.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
    } finally {
      spy.mockRestore();
    }
    expect(lines.map((line) => JSON.parse(line).security_event)).toEqual(['redirect_refused']);
  });

  it('口の引数(要求と文脈)をそのまま渡し、応答を素通しする', async () => {
    const seen: unknown[] = [];
    const handler = guardRoute(async (req: Request, context: { readonly params: Promise<{ readonly id: string }> }) => {
      seen.push(req.url, await context.params);
      return new Response('ok', { status: 200 });
    });
    const response = await handler(request(), { params: Promise.resolve({ id: 'a' }) });
    expect(await response.text()).toBe('ok');
    expect(seen).toEqual(['https://app.example/api/x', { id: 'a' }]);
  });
});

describe('guardRoute(口が投げた転送の合図)', () => {
  /** Next.js の `redirect()` が投げる合図の形。 */
  const signal = (target: string): Error => Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${target};307;` });

  it.each([
    ['外の URL', 'https://evil.example/login', 'block'],
    ['プロトコル相対', '//evil.example', 'block'],
    ['合図の綴りの崩れ(行き先が空)', '', 'block'],
    ['相対パス(投げ直す)', '/login', 'rethrow'],
    ['; を含む相対パス(投げ直す)', '/a;b', 'rethrow'],
  ])('%s', async (_name, target, expected) => {
    const thrown = signal(target);
    const memory = memoryLogger();
    const handler = guardRoute(
      () => {
        throw thrown;
      },
      { logger: memory.logger },
    );
    if (expected === 'rethrow') {
      await expect(handler(request())).rejects.toBe(thrown);
      expect(memory.records).toEqual([]);
      return;
    }
    const response = await handler(request());
    expect(response.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);
    expect(response.headers.get('location')).toBeNull();
    expect(memory.records[0]?.refusal_code).toBe('unsafe_redirect_signal');
  });

  it('合図でない例外はそのまま投げ直す', async () => {
    const thrown = new Error('boom');
    await expect(guardRoute(() => Promise.reject(thrown))(request())).rejects.toBe(thrown);
  });
});

describe('判定の純関数', () => {
  it.each([
    ['https://auth.example', true],
    ['http://127.0.0.1:54321', true],
    ['https://auth.example/', false],
    ['https://auth.example/x', false],
    ['https://AUTH.example', false],
    ['ftp://auth.example', false],
    ['//auth.example', false],
  ])('isExactOrigin(%s) = %s', (origin, expected) => {
    expect(isExactOrigin(origin)).toBe(expected);
  });

  it.each([
    ['/x', [], true],
    ['https://auth.example/x', [], false],
    ['https://auth.example/x', ['https://auth.example'], true],
    ['https://evil.example/x', ['https://auth.example'], false],
  ] as const)('locationAllowed(%s, %j) = %s', (value, origins, expected) => {
    expect(locationAllowed(value, origins)).toBe(expected);
  });

  it('見出しの判定は Location と Refresh の両方を名前の大文字小文字を問わず見る', () => {
    expect(redirectHeadersVerdict(new Headers({ LOCATION: '/x' }), [])).toBeNull();
    expect(redirectHeadersVerdict(new Headers({ LOCATION: 'https://evil.example' }), [])).toBe('unsafe_location');
    expect(redirectHeadersVerdict(new Headers({ REFRESH: '1' }), [])).toBe('refresh_header');
  });

  it.each([
    [{ digest: 'NEXT_REDIRECT;push;/a;b;303;' }, '/a;b'],
    [{ digest: 'NEXT_REDIRECT;replace;;307;' }, ''],
    [{ digest: 'NEXT_NOT_FOUND' }, null],
    [{ digest: 1 }, null],
    [new Error('x'), null],
    ['NEXT_REDIRECT;replace;/a;307;', null],
    [null, null],
  ])('redirectSignalTarget(%j) = %j', (error, expected) => {
    expect(redirectSignalTarget(error)).toBe(expected);
  });
});

describe('isGuardedRoute', () => {
  it('guardRoute が返した口だけが真', () => {
    const handler = (): Response => new Response(null);
    expect(isGuardedRoute(guardRoute(handler))).toBe(true);
    expect(isGuardedRoute(handler)).toBe(false);
    expect(isGuardedRoute(async () => new Response(null))).toBe(false);
    expect(isGuardedRoute(undefined)).toBe(false);
    expect(isGuardedRoute({})).toBe(false);
  });
});
