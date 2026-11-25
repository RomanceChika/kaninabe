/**
 * docs の開発サーバ(`vitepress dev`)を**本物の設定で 1 本だけ短く起こし**、依存の脆弱性の受け入れ(dependency-accepted.md)の理由が
 * 今の版で成り立つことを実行で確かめて止める(2026-11-12 の見直し)。
 *
 * - **外の機械から届く経路**: 待ち受けが loopback(`127.0.0.1`)だけであること。設定 `vite.server.host` を既定に頼らず明示している。
 *   機械の外向きの番地(と `::1`)へは繋がらない。
 * - **開発者のブラウザ経由の経路**(localhost の待ち受けでは塞がらない): 別 origin の要求に CORS の許可を返さない(応答を読めない)・
 *   別の Host(DNS rebinding)を 403 で断る・別 origin の WebSocket(HMR)をトークン無しで繋がない。
 * - **GHSA-9jrq-w75r-8gcw の形**: 要求の URL の `//別の host/…?/../..` が、返す HTML の script に写らない。
 *
 * どれも対照(同じ origin・正しい Host・Origin の無い WebSocket は通る)を並べ、検査が黙って空振りしないようにする。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutGitEnv } from '../../helpers/git-env.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const DOCS = path.join(REPO_ROOT, 'docs');
const VITEPRESS_BIN = path.join(DOCS, 'node_modules/vitepress/bin/vitepress.js');
const installed = existsSync(VITEPRESS_BIN);
if (!installed && (process.env['CI'] ?? '') !== '') throw new Error(`CI に docs の依存がありません(${VITEPRESS_BIN})。docs/ の npm ci を回してください`);

mkdirSync(path.join(REPO_ROOT, 'tmp'), { recursive: true });
/** 設定一式を写した小さな木(リポジトリの tmp の下。git の管理の外)。 */
const site = mkdtempSync(path.join(REPO_ROOT, 'tmp', 'docs-dev-server-'));

const EVIL_ORIGIN = 'http://evil.example';
const EVIL_HOST = 'evil.example';
const WS_HEADERS = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Protocol': 'vite-hmr' };

let server: ChildProcess | null = null;
let port = 0;
let output = '';

/** 空いている番号を 1 つ得る。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('番号を得られません'));
      });
    });
  });
}

/** 色の制御列(ESC で始まる)。runner が色を強制しても「Local:」が割れないように外して見る。 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/** 開発サーバが「Local:」を出すまで待つ。 */
function waitReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`開発サーバが起きません:\n${output}`)), 120_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.replace(ANSI, '').includes('Local:')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`開発サーバが終わりました(${String(code)}):\n${output}`));
    });
  });
}

/** 止める(SIGTERM、5 秒で終わらなければ SIGKILL)。 */
function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** 127.0.0.1 の開発サーバへ 1 本送る(パスはそのまま送る・Host は上書きできる)。WebSocket の昇格は 101 として返す。 */
function send(requestPath: string, headers: Record<string, string>, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers, timeout: 10_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: '' });
    });
    request.on('timeout', () => request.destroy(new Error('時間切れ')));
    request.on('error', reject);
    request.end();
  });
}

/** 番地へ TCP で繋がるか(繋がったら true)。 */
function connects(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

beforeAll(async () => {
  if (!installed) return;
  cpSync(path.join(DOCS, '.vitepress'), path.join(site, '.vitepress'), {
    recursive: true,
    filter: (source) => !['dist', 'cache'].some((name) => source.includes(`${path.sep}.vitepress${path.sep}${name}`)),
  });
  symlinkSync(path.join(DOCS, 'node_modules'), path.join(site, 'node_modules'));
  for (const dir of ['rules', 'specs']) {
    mkdirSync(path.join(site, dir), { recursive: true });
    writeFileSync(path.join(site, dir, 'README.md'), `# ${dir}\n`);
  }
  writeFileSync(path.join(site, 'index.md'), '# home\n');
  writeFileSync(path.join(site, 'package.json'), '{"type":"module"}');
  port = await freePort();
  // --host を渡さない: 待ち受けの番地は設定(docs/.vitepress/config.ts の vite.server.host)だけで決まる。
  server = spawn(process.execPath, [VITEPRESS_BIN, 'dev', '.', '--port', String(port), '--strictPort'], { cwd: site, env: { ...withoutGitEnv(), NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitReady(server);
}, 180_000);

afterAll(async () => {
  if (server !== null) await stop(server);
  rmSync(site, { recursive: true, force: true });
}, 30_000);

describe.skipIf(!installed)('docs の開発サーバ(本物の設定・vite 5.4.21)', () => {
  it('待ち受けは 127.0.0.1 だけ(外向きの番地と ::1 には繋がらない)', async () => {
    expect(output).toContain(`Local:   http://127.0.0.1:${String(port)}/`);
    expect(await connects('127.0.0.1')).toBe(true);
    const outward = Object.values(os.networkInterfaces())
      .flatMap((list) => list ?? [])
      .filter((entry) => !entry.internal && !entry.address.startsWith('fe80:'))
      .map((entry) => entry.address);
    for (const host of ['::1', ...outward]) expect({ host, connects: await connects(host) }).toEqual({ host, connects: false });
  });

  it('別 origin の要求には CORS の許可を返さない(対照: 同じ origin には返す)', async () => {
    const same = `http://127.0.0.1:${String(port)}`;
    expect((await send('/', { Origin: same })).headers['access-control-allow-origin']).toBe(same);
    const evil = await send('/', { Origin: EVIL_ORIGIN });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await send('/', { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'GET' }, 'OPTIONS');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('別の Host(DNS rebinding)は 403 で断る(対照: 127.0.0.1 と localhost は通す)', async () => {
    expect((await send('/', { Host: `127.0.0.1:${String(port)}` })).status).toBe(200);
    expect((await send('/', { Host: `localhost:${String(port)}` })).status).toBe(200);
    for (const host of [EVIL_HOST, `${EVIL_HOST}:${String(port)}`]) {
      const reply = await send('/', { Host: host });
      expect({ host, status: reply.status }).toEqual({ host, status: 403 });
      expect(reply.body).toContain('Blocked request');
    }
  });

  it('WebSocket(HMR)は別 origin・別 Host をトークン無しで繋がない(対照: Origin の無い要求は 101)', async () => {
    expect((await send('/', WS_HEADERS)).status).toBe(101);
    expect((await send('/', { ...WS_HEADERS, Origin: EVIL_ORIGIN })).status).not.toBe(101);
    expect((await send('/', { ...WS_HEADERS, Host: EVIL_HOST })).status).not.toBe(101);
  });

  it('GHSA-9jrq-w75r-8gcw の形: 要求の URL の別の host が返す HTML の script に写らない', async () => {
    for (const requestPath of ['//evil.example/payload.js?/../../package.json', '//evil.example/x.html', '/index.html?/../../package.json']) {
      const reply = await send(requestPath, {});
      expect({ requestPath, reflected: reply.body.includes('evil.example') }).toEqual({ requestPath, reflected: false });
    }
    // 対照: 同じ形の HTML の要求は script を返している(空の応答で空振りしていない)
    expect((await send('/index.html', {})).body).toContain('<script type="module"');
  });
});
