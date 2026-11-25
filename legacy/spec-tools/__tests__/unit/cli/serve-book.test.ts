/**
 * 本の静的サーバ(`cli/serve-book.ts`)の URL の解き方と、本物のサーバの約束のテスト。
 *
 * 配るのは本の置き場の下のファイルだけ。`..`・NUL・バックスラッシュ・符号化した同じ並びは断り、`/` とディレクトリは `index.html` に解く。
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOK_HOST, contentTypeOf, hostAllowed, resolveBookPath, startBookServer } from '../../../cli/serve-book.js';
import { BOOK_CSP } from '../../../lib/generate/render/book/html/markup.js';

const ROOT = path.resolve('/srv/book');
const inside = (...parts: string[]): string => path.join(ROOT, ...parts);

describe('resolveBookPath', () => {
  it('通常のパスは置き場の中のファイルに解く(クエリ・フラグメントは落とす)', () => {
    expect(resolveBookPath(ROOT, '/spec/item.html')).toBe(inside('spec', 'item.html'));
    expect(resolveBookPath(ROOT, '/assets/search.json?x=1#a')).toBe(inside('assets', 'search.json'));
    expect(resolveBookPath(ROOT, '/%E3%81%82.html')).toBe(inside('あ.html'));
  });

  it('`/` と末尾が `/` のパスは index.html に解く', () => {
    expect(resolveBookPath(ROOT, '/')).toBe(inside('index.html'));
    expect(resolveBookPath(ROOT, '/?q=1')).toBe(inside('index.html'));
    expect(resolveBookPath(ROOT, '/spec/')).toBe(inside('spec', 'index.html'));
  });

  it.each([
    '/../etc/passwd',
    '/spec/../../etc/passwd',
    '/..',
    '/%2e%2e/etc/passwd',
    '/%2E%2E%2Fetc/passwd',
    '/spec/%2e%2e/%2e%2e/x',
    '/a\\..\\b',
    '/a%5C..%5Cb',
    '/index.html\0.png',
    '/index.html%00.png',
    '//evil.example/x',
    'index.html',
    '',
    '/%',
    '/%E0%A4%A',
  ])('断る: %j', (requestUrl) => {
    expect(resolveBookPath(ROOT, requestUrl)).toBeNull();
  });

  it('置き場と同じ接頭辞の兄弟ディレクトリへは出られない', () => {
    expect(resolveBookPath(ROOT, '/../book-secret/x')).toBeNull();
  });
});

describe('contentTypeOf', () => {
  it('拡張子の表で決め、表に無いものは octet-stream', () => {
    expect(contentTypeOf('a.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeOf('a.JSON')).toBe('application/json; charset=utf-8');
    expect(contentTypeOf('a.woff2')).toBe('font/woff2');
    expect(contentTypeOf('a.bin')).toBe('application/octet-stream');
  });
});

describe('本物のサーバ(点検 13 回目 C13-1・C13-7)', () => {
  const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
  let top = '';
  let root = '';
  let server: http.Server;
  let port = 0;

  /** 素の要求(`Host` とパスをそのまま送る)。 */
  const request = (target: string, options: { readonly method?: string; readonly host?: string | null } = {}): Promise<{ readonly status: number; readonly headers: http.IncomingHttpHeaders; readonly body: string }> =>
    new Promise((resolve, reject) => {
      const headers = options.host === null ? {} : { Host: options.host ?? `127.0.0.1:${port}` };
      const call = http.request({ host: '127.0.0.1', port, path: target, method: options.method ?? 'GET', headers, setHost: false }, (response) => {
        let body = '';
        response.setEncoding('utf-8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      });
      call.on('error', reject);
      call.end();
    });

  beforeAll(async () => {
    top = realpathSync(mkdtempSync(path.join(tmpdir(), 'serve-book-')));
    root = path.join(top, 'book');
    mkdirSync(path.join(root, 'spec'), { recursive: true });
    mkdirSync(path.join(top, 'book-secret'));
    writeFileSync(path.join(top, 'secret.html'), 'SECRET');
    writeFileSync(path.join(top, 'book-secret', 'x.html'), 'SECRET');
    writeFileSync(path.join(root, 'index.html'), '<p>本</p>');
    writeFileSync(path.join(root, 'spec', 'index.html'), '<p>章</p>');
    writeFileSync(path.join(root, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    writeFileSync(path.join(root, '.env'), 'SECRET=1');
    writeFileSync(path.join(root, 'x.bin'), 'x');
    symlinkSync(path.join(top, 'secret.html'), path.join(root, 'out.html'));
    symlinkSync(path.join(top, 'book-secret'), path.join(root, 'sibling'));
    symlinkSync(path.join(root, 'index.html'), path.join(root, 'in.html'));
    await new Promise<void>((resolve) => {
      server = startBookServer(root, 0, resolve);
    });
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(top, { recursive: true, force: true });
  });

  it('待ち受けは 127.0.0.1 だけ', () => {
    expect(BOOK_HOST).toBe('127.0.0.1');
    expect(server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
  });

  it('全部の応答に nosniff・no-cache・ページと同じ CSP が付く(200 と 404 と 405 と 403)', async () => {
    expect(BOOK_CSP).toBe(CSP);
    for (const reply of [await request('/'), await request('/none.html'), await request('/', { method: 'POST' }), await request('/', { host: 'evil.example' })]) {
      expect(reply.headers['content-security-policy']).toBe(CSP);
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.headers['cache-control']).toBe('no-cache');
    }
  });

  it('本の中のファイルを配る(ディレクトリは index.html・種類は表のとおり・中を指すリンクは実体で配る)', async () => {
    expect(await request('/')).toMatchObject({ status: 200, body: '<p>本</p>' });
    expect(await request('/spec')).toMatchObject({ status: 200, body: '<p>章</p>' });
    expect(await request('/spec/')).toMatchObject({ status: 200, body: '<p>章</p>' });
    expect(await request('/in.html')).toMatchObject({ status: 200, body: '<p>本</p>' });
    expect((await request('/a.svg')).headers['content-type']).toBe('image/svg+xml');
  });

  it('HEAD は本文なしで同じ見出し', async () => {
    const reply = await request('/', { method: 'HEAD' });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('');
    expect(reply.headers['content-length']).toBe(String(Buffer.byteLength('<p>本</p>')));
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('%s は 405', async (method) => {
    const reply = await request('/', { method });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe('GET, HEAD');
  });

  it.each(['/../secret.html', '/spec/../../secret.html', '/%2e%2e/secret.html', '/%2E%2E%2Fsecret.html', '/a%5C..%5Cb', '/index.html%00.png', '//evil.example/x', 'http://evil.example/'])('パス %s は 400', async (target) => {
    const reply = await request(target);
    expect(reply.status).toBe(400);
    expect(reply.body).not.toContain('SECRET');
  });

  it.each(['/out.html', '/sibling/x.html', '/.env', '/x.bin', '/none.html'])('%s は 404(外へ出るリンク・兄弟の木・`.` で始まる節・表に無い拡張子・無いファイル)', async (target) => {
    const reply = await request(target);
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain('SECRET');
  });

  it('`Host` は 127.0.0.1 / localhost + このポートだけ', async () => {
    expect((await request('/', { host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await request('/', { host: `localhost:${port}` })).status).toBe(200);
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', 'localhost', `0.0.0.0:${port}`, `[::1]:${port}`]) expect((await request('/', { host })).status, host).toBe(403);
    // `Host` の無い HTTP/1.1 は Node のサーバが手前で 400 にする。
    expect((await request('/', { host: null })).status).toBe(400);
  });

  it('hostAllowed の表', () => {
    expect(hostAllowed('127.0.0.1:80', 80)).toBe(true);
    expect(hostAllowed('localhost:80', 80)).toBe(true);
    expect(hostAllowed(undefined, 80)).toBe(false);
    expect(hostAllowed('LOCALHOST:80', 80)).toBe(false);
  });
});
