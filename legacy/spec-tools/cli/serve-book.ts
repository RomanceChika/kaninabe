/**
 * 生成した本(`docs/book/` の HTML)を手元で開くための静的サーバ。
 *
 * 使い方:
 *   npm run book:open                 — 本を `http://127.0.0.1:4173/` で配る(止めるときは Ctrl+C)
 *   npm run book:open -- --port 8080  — 待ち受けのポートを変える
 *   `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *
 * 本の検索(`assets/search.json` を `fetch` で読む)は `file://` では動かないので、本を開くにはこのサーバを使う。VitePress は手書きの文書(`docs/`)専用で、
 * 生成した本は配らない。
 *
 * - **待ち受けは `127.0.0.1` だけ**(ほかの機械から届かない)。GET / HEAD だけを受け、それ以外は 405。
 * - **`Host` は `127.0.0.1` / `localhost` + このポートだけ**(DNS rebinding で外のページが本を読むのを止める)。ほかは 403。
 * - **配るのは本の置き場(製品が宣言する `roots.book`)の下のファイルだけ**。URL は `resolveBookPath` で検査する: NUL・バックスラッシュ・`..` の節・
 *   (復号した後の)同じ並びを断り、結合した結果が本の置き場の外なら断る。シンボリックリンクは実体の位置で置き場の中かを見直す。
 * - `.` で始まる節と拡張子の表に無いファイルは 404(本の木に迷い込んだ `.env` などを配らない)。
 * - `/` とディレクトリは `index.html`。種類は拡張子の表で決め、全部の応答に `X-Content-Type-Options: nosniff` と**ページの `<meta>` と同じ CSP** を付ける
 *   (ページの外の素の断片や SVG は `<meta>` を持たないので、応答の見出しで止める)。
 *
 * 終了コード: 起動できなければ 1(置き場が無い・ポートが使えない・引数が不正)。
 */

import { createReadStream, realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { BOOK_CSP } from '../lib/generate/render/book/html/markup.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { bookPath } from '../lib/model/product/paths.js';
import { repoRootOrExit, withoutRootOption } from './repo-root.js';

/** 待ち受けの住所(自分の機械の中だけ)。 */
export const BOOK_HOST = '127.0.0.1';

/** 既定のポート。 */
const DEFAULT_PORT = 4173;

/** 拡張子ごとの Content-Type(表に無い拡張子は `application/octet-stream`)。 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * 拡張子から Content-Type を決める。
 *
 * @param file ファイルのパス
 */
export function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** 文字列に、制御文字の NUL とバックスラッシュのどちらかがあるか。 */
function hasForbiddenChar(value: string): boolean {
  return value.includes('\0') || value.includes('\\');
}

/**
 * リクエストの URL(パスとクエリ)を、本の置き場の中のファイルの位置に解く。
 *
 * 断るもの: `/` で始まらない値・NUL・バックスラッシュ・`..` の節(符号化されたものを復号した後も)・復号できない `%` の列・結合した結果が置き場の外になるもの。
 * `/` と末尾が `/` のパスは `index.html` を指す(ディレクトリが実在するかは呼び手が見る)。純粋関数(ファイルは見ない)。
 *
 * @param bookRoot 本の置き場の絶対パス
 * @param requestUrl リクエスト行の URL(例: `/spec/item.html?x=1`)
 * @returns 置き場の中の絶対パス。断るなら null
 */
export function resolveBookPath(bookRoot: string, requestUrl: string): string | null {
  if (!requestUrl.startsWith('/') || requestUrl.startsWith('//') || hasForbiddenChar(requestUrl)) return null;
  const rawPath = requestUrl.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (hasForbiddenChar(decoded)) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return null;
  const root = path.resolve(bookRoot);
  const target = path.resolve(root, ...segments, ...(decoded.endsWith('/') || segments.length === 0 ? ['index.html'] : []));
  return target === root || !target.startsWith(root + path.sep) ? null : target;
}

/** 応答の頭(全部の応答で共通)。 */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': BOOK_CSP } as const;

/** 本文のない応答を返す。 */
function reply(response: http.ServerResponse, status: number, extra: Record<string, string> = {}): void {
  response.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  response.end(status === 405 ? '' : `${status}\n`);
}

/**
 * `Host` がこのサーバの住所か(閉じた表。無ければ違う)。
 *
 * @param host `Host` の見出し
 * @param port 待ち受けのポート
 */
export function hostAllowed(host: string | undefined, port: number | undefined): boolean {
  return host === `${BOOK_HOST}:${port}` || host === `localhost:${port}`;
}

/** 配ってよいファイルか(要求の節に `.` で始まるものが無く、実体の拡張子が表にある)。置き場の外かは実体の位置で別に見る。 */
function servable(bookRoot: string, requested: string, file: string): boolean {
  const dotted = path.relative(bookRoot, requested).split(path.sep).some((segment) => segment.startsWith('.'));
  return !dotted && Object.hasOwn(CONTENT_TYPES, path.extname(file).toLowerCase());
}

/**
 * リクエスト 1 件を配る。
 *
 * @param bookRoot 本の置き場の絶対パス(実体の位置)
 */
async function serve(bookRoot: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const method = request.method ?? '';
  if (method !== 'GET' && method !== 'HEAD') return reply(response, 405, { Allow: 'GET, HEAD' });
  if (!hostAllowed(request.headers.host, request.socket.localPort)) return reply(response, 403);
  const candidate = resolveBookPath(bookRoot, request.url ?? '');
  if (candidate === null) return reply(response, 400);
  try {
    let file = await realpath(candidate);
    if ((await stat(file)).isDirectory()) file = await realpath(path.join(file, 'index.html'));
    // シンボリックリンクで置き場の外へ出ていないか(実体の位置で見直す)。
    if (!file.startsWith(bookRoot + path.sep)) return reply(response, 404);
    const info = await stat(file);
    if (!info.isFile() || !servable(bookRoot, candidate, file)) return reply(response, 404);
    response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': contentTypeOf(file), 'Content-Length': String(info.size) });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch {
    reply(response, 404);
  }
}

/** `--port` の値(`--port 8080` / `--port=8080`)。無ければ既定、不正なら null。 */
function portOf(args: readonly string[]): number | null {
  const inline = args.find((arg) => arg.startsWith('--port='));
  const at = args.indexOf('--port');
  const raw = inline !== undefined ? inline.slice('--port='.length) : at >= 0 ? args[at + 1] : undefined;
  if (inline === undefined && at < 0) return DEFAULT_PORT;
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * 本を配るサーバを `127.0.0.1` で起こす。
 *
 * @param bookRoot 本の置き場の絶対パス(実体の位置)
 * @param port 待ち受けのポート(0 は空いている番号)
 * @param onListening 待ち受けが始まったとき
 */
export function startBookServer(bookRoot: string, port: number, onListening: () => void): http.Server {
  const server = http.createServer((request, response) => {
    void serve(bookRoot, request, response);
  });
  server.listen(port, BOOK_HOST, onListening);
  return server;
}

function main(): number {
  const args = withoutRootOption(process.argv.slice(2));
  const port = portOf(args);
  if (port === null) {
    console.error('book:open: --port には 1〜65535 の整数を渡してください。');
    return 1;
  }
  const repoRoot = repoRootOrExit('book:open', process.argv.slice(2));
  const roots = loadProductRoots(repoRoot).model.roots;
  if (roots === null) {
    console.error('book:open: 製品の根の宣言(product.md)を読めません。npm run verify の P 群を先に通してください。');
    return 1;
  }
  const bookRoot = path.join(repoRoot, bookPath(roots));
  let real: string;
  try {
    real = realpathSync(bookRoot);
    if (!statSync(path.join(real, 'index.html')).isFile()) throw new Error('index.html is not a file');
  } catch {
    console.error(`book:open: ${bookRoot}/index.html がありません。先に npm run generate で本を生成してください。`);
    return 1;
  }
  const server = startBookServer(real, port, () => {
    console.log(`本を配っています: http://${BOOK_HOST}:${port}/ (止めるときは Ctrl+C)`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`book:open: 待ち受けられません(${error.code ?? error.message})。--port で別のポートを選んでください。`);
    process.exit(1);
  });
  return 0;
}

// テストが `resolveBookPath` を読み込んだだけではサーバを起こさない(直接実行されたときだけ起動する)。
const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === realpathSync(entry)) {
  const code = main();
  if (code !== 0) process.exit(code);
}
