/**
 * Z3 のセッションを**閉じ込める worker の本体**(`z3-host.ts` が `worker_threads` で起動する)。
 *
 * 起動・main 文脈・問いごとの scratch 文脈・ソルバーは全部ここだけが持つ。解放は worker の寿命で行う
 * (文脈ごとの解放はしない: 高水準 API の finalizer と二重解放になりうるため、親が worker を止めて
 * 資源ごと捨てる)。親へは判定の結果と読み取った値の綴りだけを返す。
 *
 * このファイルは Node の型除去でそのまま読まれる(親は `.ts` の URL で起動する)ので、
 * 実行時に効く import は `node:` と `z3-solver` だけにする(ほかのファイルへは型の import のみ)。
 */

import { parentPort } from 'node:worker_threads';
import z3 from 'z3-solver';
import type { CheckRequest, WorkerRequest, WorkerResponse } from './z3-protocol.js';

type Z3Api = Awaited<ReturnType<typeof z3.init>>;

const port = parentPort;
if (port === null) throw new Error('z3-worker は worker_threads の中でだけ動く');

/** 文脈の作り口(名前は実行時の文字列なので、型の名前は `string` に開く)。 */
function newContext(z3api: Z3Api, name: string) {
  return new z3api.Context(name);
}

let booting: Promise<Z3Api> | null = null;
let main: ReturnType<typeof newContext> | null = null;
let scratchCount = 0;

function post(message: WorkerResponse): void {
  port?.postMessage(message);
}

/**
 * Z3 を起動する。起動の Promise を共有するので、何度呼ばれても `init()` は 1 回しか走らない。
 * 起動に失敗したときは覚えず、次の問いがもう一度試す。
 */
function boot(): Promise<Z3Api> {
  booting ??= z3.init().catch((error: unknown) => {
    booting = null;
    throw error;
  });
  return booting;
}

/**
 * WASM の abort か(名前が `RuntimeError`、または文面が Emscripten の `Aborted(` で始まる)。壊れた Emscripten モジュールは
 * 後続の問いを別の文面で落とし続けるので、親に直ちの入れ替えを頼む。文面の途中に `Aborted` を含むだけ
 * (SMT の識別子など)の普通の失敗は abort ではない。
 */
function isWasmAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return /^Aborted\(/u.test(String(error));
  return error.name === 'RuntimeError' || /^Aborted\(/u.test(error.message);
}

/** 問いを解く文脈。`main` は使い回し、`scratch` は問いごとに新しく作る。 */
function contextFor(z3api: Z3Api, which: CheckRequest['context']): ReturnType<typeof newContext> {
  if (which === 'main') {
    main ??= newContext(z3api, 'main');
    return main;
  }
  scratchCount += 1;
  return newContext(z3api, `scratch-${scratchCount}`);
}

/** Z3 の割当の見積り(バイト)。 */
function estimatedBytes(z3api: Z3Api): number {
  return Number(z3api.Z3.get_estimated_alloc_size());
}

async function handleCheck(request: CheckRequest): Promise<void> {
  let allocBytes = 0;
  try {
    post({ type: 'started', id: request.id });
    const z3api = await boot();
    allocBytes = estimatedBytes(z3api);
    const recycle = allocBytes > request.recycleAboveBytes;
    const solver = new (contextFor(z3api, request.context).Solver)();
    for (const [key, value] of request.params) solver.set(key, value);
    for (const source of request.sources) solver.fromString(source);
    const status = await solver.check();
    if (status !== 'sat' || !request.withModel) {
      post({ type: 'reply', id: request.id, status, allocBytes, recycle });
      return;
    }
    const model = solver.model();
    const values = model.decls().map((decl) => [String(decl.name()), model.get(decl as never).toString()] as const);
    post({ type: 'reply', id: request.id, status, values, allocBytes, recycle });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = isWasmAbort(error);
    const recycle = allocBytes > request.recycleAboveBytes || aborted;
    post({ type: 'failure', id: request.id, message, allocBytes, recycle, aborted });
  }
}

/**
 * 問いは worker の中で**1 問ずつ順に**解く(キュー)。Z3 のモジュールは 1 本の mutex を共有しているので、
 * 同時に実行しても速くならず、後ろの問いの時間が前の問いの待ちに食われるだけである。
 */
let queue: Promise<void> = Promise.resolve();

port.on('message', (message: WorkerRequest) => {
  // 返事を送れなかった問い(親への postMessage の失敗)でキューの連鎖を拒否のままにしない: 後ろの問いは続ける。
  queue = queue.then(() => handleCheck(message)).catch(() => undefined);
});
