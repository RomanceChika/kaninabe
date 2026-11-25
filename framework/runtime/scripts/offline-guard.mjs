/**
 * **ビルドの外への通信の見張り**(Node の前置き。`node --import <この URL> …`。呼び手は `build-offline.mjs` で、`NODE_OPTIONS` で子のプロセスにも引き継ぐ)。
 *
 * `next build` は書体(`next/font/google`)などを外へ取りに行けた。ビルドが外に依ると、通信の無い環境(サンドボックス・止まった CI の runner)で
 * 赤になり、取得先が返す中身もビルドの入力になる。ここはビルドのプロセスの中で、外へ出る口(`net` のソケットの接続 = `http` / `https` / `tls` /
 * `fetch`(undici)の土台・`dns` の名前引き)を見張り、**手元(ループバック)の外へ出ようとしたら記録して例外にする**。許す宛先は
 * `offline-hosts.mjs` の閉じた表で、**空**である。記録の置き場は `ST_OUTBOUND_LOG`(呼び手が渡す)。
 *
 * 点検 20 回目 C20-4 で、プロセスの中の残りの口を閉じた: **worker_threads**(`--import` はスレッドに入らない。スレッドの頭で見張りを読み込ませる)・
 * **環境を組み直して起こした子**(`env: { PATH }` のように `NODE_OPTIONS` を落としても、子の環境に前置きと記録の置き場を足す)・
 * **`dns` の名前の問い合わせ**(c-ares。`lookup` と別の道)・**`dgram`**(UDP の送り先)。ESM の名前つきの取り込みにも差し替えを映す。
 * 点検 21 回目 C21-3 で、ESM の文法の評価のスレッド(頭を CJS と ESM の両方で動く形に)・環境を渡さずに起こした子(起こす前に今の環境の前置きを戻す)・
 * `dns.lookupService` を閉じた。
 *
 * **残る前提(見ない下限)**: Node の外で通信する部分 —— Rust の Turbopack・SWC が自分で外へ出る取得は、この見張りから見えない。そこは
 * 閉じた表(`layer/root-layout-closed` などが `next/font/google` を止める = 書体は `next/font/local` で同梱する)と、通信を切ったサンドボックスでの
 * E2E が見る。ほかに、ネイティブのアドオンの通信・`process.binding` を直に使う口・見張りより先に読み込まれて元の関数を握ったコードも見ない。
 * 依存は node の標準だけ。
 */

import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { resolve as absolutePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import workerThreads from 'node:worker_threads';
import { allowed } from './offline-hosts.mjs';

/** 記録の置き場(呼び手が渡す。無ければ例外だけ)。 */
const LOG = process.env['ST_OUTBOUND_LOG'] ?? '';

/**
 * 外へ出ようとした宛先を記録して、投げる例外を作る。
 *
 * @param {string} via - 口の名前
 * @param {string} host - 宛先
 * @returns {Error} 投げる例外
 */
function refusal(via, host) {
  if (LOG !== '') appendFileSync(LOG, `${via}\t${host}\t${String(process.pid)}\n`);
  return new Error(`build: 外への通信は許していません(${via} → ${host})。ビルドは手元だけで閉じます(offline-hosts.mjs の ALLOWED_HOSTS は空)`);
}

/**
 * `net.Socket#connect` の引数から宛先を取り出す(`connect(port, host)` / `connect({ host, port })` / `connect(path)`)。
 *
 * @param {readonly unknown[]} args - connect の引数
 * @returns {string} 宛先(Unix の socket は空文字)
 */
function hostOf(args) {
  const first = args[0];
  if (Array.isArray(first)) return hostOf(first);
  if (first !== null && typeof first === 'object') {
    const options = /** @type {{ path?: unknown, host?: unknown, hostname?: unknown }} */ (first);
    if (typeof options.path === 'string') return '';
    const host = options.host ?? options.hostname ?? 'localhost';
    return typeof host === 'string' ? host : 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return '';
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = hostOf(args);
  if (!allowed(host)) throw refusal('net.connect', host);
  return Reflect.apply(originalConnect, this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (!allowed(hostname)) throw refusal('dns.lookup', String(hostname));
  return Reflect.apply(originalLookup, this, [hostname, ...rest]);
};

const originalPromiseLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromiseLookup(hostname, ...rest) {
  if (!allowed(hostname)) return Promise.reject(refusal('dns.promises.lookup', String(hostname)));
  return Reflect.apply(originalPromiseLookup, this, [hostname, ...rest]);
};

// ---- 点検 20 回目 C20-4: worker_threads・環境を組み直した子・dns の名前の問い合わせ・dgram ----

/** この前置きの置き場(スレッドの頭で読み込ませる)。 */
const GUARD_PATH = fileURLToPath(import.meta.url);

/** 子に引き継ぐ前置き(`NODE_OPTIONS` に足す 1 語)。 */
const GUARD_IMPORT = `--import=${import.meta.url}`;

/**
 * 子のプロセスの環境に、見張りの前置きと記録の置き場を足す(呼び手が環境を組み直して `NODE_OPTIONS` を落としても、子の node に見張りが入る)。
 *
 * @param {Record<string, string | undefined>} env - 子に渡す環境
 * @returns {Record<string, string | undefined>} 足した環境(元は変えない)
 */
export function guardedEnv(env) {
  const options = env['NODE_OPTIONS'] ?? '';
  return {
    ...env,
    NODE_OPTIONS: options.includes(GUARD_IMPORT) ? options : [options, GUARD_IMPORT].filter((part) => part !== '').join(' '),
    ...(LOG === '' || env['ST_OUTBOUND_LOG'] !== undefined ? {} : { ST_OUTBOUND_LOG: LOG }),
  };
}

/**
 * 子のプロセスを起こす関数の引数のうち、環境を組み直しているもの(`options.env`)に見張りを足す。
 *
 * @param {readonly unknown[]} args - 元の引数
 * @returns {unknown[]} 足した引数
 */
function withGuardedEnv(args) {
  return args.map((arg) => {
    if (arg === null || typeof arg !== 'object' || Array.isArray(arg)) return arg;
    const options = /** @type {{ env?: Record<string, string | undefined> }} */ (arg);
    return options.env === undefined ? arg : { ...options, env: guardedEnv(options.env) };
  });
}

/**
 * 環境を渡さずに起こす子は今の環境を継ぐので、今の環境の前置きと記録の置き場を戻しておく(点検 21 回目 C21-3。
 * `delete process.env.NODE_OPTIONS` の後に env 無しで起こした子は、前置きの消えた親の環境を継いで見張りの外だった)。
 */
function restoreOwnGuard() {
  const options = process.env['NODE_OPTIONS'] ?? '';
  if (!options.includes(GUARD_IMPORT)) process.env['NODE_OPTIONS'] = [options, GUARD_IMPORT].filter((part) => part !== '').join(' ');
  if (LOG !== '' && process.env['ST_OUTBOUND_LOG'] === undefined) process.env['ST_OUTBOUND_LOG'] = LOG;
}

// 子のプロセスを起こす口を包む(この見張りだけが `child_process` の束縛を差し替える。lint の no-os-command はこのファイルだけ外す)。
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = childProcess[name];
  childProcess[name] = function guardedChild(...args) {
    restoreOwnGuard();
    return Reflect.apply(original, this, withGuardedEnv(args));
  };
}

/** 元の worker_threads.Worker。 */
const OriginalWorker = workerThreads.Worker;

/**
 * スレッドの頭で見張りを読み込ませる(`--import` はスレッドに入らない。`execArgv` に足しても効かない — 実測)。
 * 評価の文字列はその頭に、ファイルのスレッドは見張りを読んでから `import()` する評価の文字列に包む。
 */
class GuardedWorker extends OriginalWorker {
  /**
   * 見張りを頭に置いたスレッドを起こす。
   *
   * @param {string | URL} filename - スレッドの本体
   * @param {import('node:worker_threads').WorkerOptions} [options] - 選択
   */
  constructor(filename, options = {}) {
    // CJS と ESM のどちらの評価の本文でも動く頭(点検 21 回目 C21-3。`require(…)` の頭は ESM の文法の本文で
    // `require is not defined in ES module scope` になり、正しいスレッドを落とした)。`process.getBuiltinModule` は両方にある。
    const head = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(GUARD_PATH)})(${JSON.stringify(GUARD_PATH)});\n`;
    if (options.eval === true) {
      super(head + String(filename), options);
    } else {
      const text = String(filename);
      const url = filename instanceof URL ? filename.href : /^(?:file|data):/.test(text) ? text : pathToFileURL(absolutePath(text)).href;
      super(`${head}import(${JSON.stringify(url)});`, { ...options, eval: true });
    }
  }
}
workerThreads.Worker = GuardedWorker;

/**
 * 外へ問い合わせる名前引き(`lookup` と別の道。c-ares が DNS の server へ直に問う)と、逆引きの `lookupService`
 * (アドレスと番号から名前を引く。外の DNS へ問う。点検 21 回目 C21-3 で足した)。
 */
const RESOLVERS = Object.keys(dns).filter((name) => /^(?:resolve|reverse|lookupService$)/.test(name) && typeof Reflect.get(dns, name) === 'function');

/**
 * 名前引きの関数を包む(宛先が手元でなければ記録して投げる)。
 *
 * @param {Record<string, unknown>} target - 包む関数の持ち主
 * @param {string} via - 口の名前の頭
 * @param {boolean} promise - 約束を返す口か
 */
function guardResolvers(target, via, promise) {
  for (const name of RESOLVERS) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function guardedResolve(hostname, ...rest) {
      if (!allowed(hostname)) {
        const error = refusal(`${via}.${name}`, String(hostname));
        if (promise) return Promise.reject(error);
        throw error;
      }
      return Reflect.apply(original, this, [hostname, ...rest]);
    };
  }
}
guardResolvers(/** @type {any} */ (dns), 'dns', false);
guardResolvers(/** @type {any} */ (dns.Resolver.prototype), 'dns.Resolver', false);
guardResolvers(/** @type {any} */ (dns.promises), 'dns.promises', true);
guardResolvers(/** @type {any} */ (dns.promises.Resolver.prototype), 'dns.promises.Resolver', true);

/**
 * `dgram` の `send` の宛先(`send(msg[, offset, length], port[, address][, cb])`)。
 *
 * @param {readonly unknown[]} args - send の引数
 * @returns {unknown} 宛先(接続済みの socket は undefined)
 */
function datagramAddress(args) {
  const offsetForm = typeof args[1] === 'number' && typeof args[2] === 'number' && typeof args[3] === 'number';
  return offsetForm ? args[4] : args[2];
}

const originalSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(...args) {
  const address = datagramAddress(args);
  if (typeof address === 'string' && !allowed(address)) throw refusal('dgram.send', address);
  return Reflect.apply(originalSend, this, args);
};

const originalDatagramConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function guardedDatagramConnect(port, address, ...rest) {
  if (typeof address === 'string' && !allowed(address)) throw refusal('dgram.connect', address);
  return Reflect.apply(originalDatagramConnect, this, [port, address, ...rest]);
};

// ESM の名前つきの取り込み(`import { lookup } from 'node:dns'`)にも差し替えを映す(既定の輸出だけを替えると名前つきは元のまま)。
syncBuiltinESMExports();
