/**
 * Z3 の worker の偽物(message を返すだけ)。親(`lib/guard/z3-host.ts`)の配線を、本物の WASM なしで確かめる。
 *
 * 渡された問いは `posted` に溜まる。答えは**テストが手で返す**(`reply` / `fail` / `crash`)ので、
 * 「返らない worker」「途中で落ちる worker」も作れる。
 *
 * 本物の worker と同じく問いを**1 問ずつ順に**扱い、先頭になった問いについて `started` を返す
 * (`autoStart: false` なら返さない = 起動できていない worker)。`postError` を立てている間は `postMessage` がその例外を投げる。
 * `onPost` は問いを受け取った直後に呼ばれる(受け取った瞬間に落ちる worker などを作る)。
 * `terminateMode` が `defer` の間、`terminate()` の Promise はテストが `finishTerminate()` / `failTerminate()` で解くまで返らない
 * (呼ぶたびに新しい保留になる。親の再確認はこの最新のものを解く)。
 * `terminateModeQueue` に積むと、`terminate()` を呼ぶたびに先頭から取り出してその回の返し方にする(尽きたら `terminateMode`)。
 */

import type { CheckRequest, WorkerResponse } from '../../lib/guard/z3-protocol.js';
import { Z3Host, type WorkerLike } from '../../lib/guard/z3-host.js';

export class FakeZ3Worker implements WorkerLike {
  readonly posted: CheckRequest[] = [];
  terminated = false;
  refs = 0;
  /** `terminate()` の返し方: すぐ解く / テストが解くまで保留 / すぐ reject / 同期に throw。 */
  terminateMode: 'resolve' | 'defer' | 'reject' | 'throw' = 'resolve';
  /** 呼び出しごとの返し方(先頭から使う。呼び出しの回で結果を変える偽物を作る)。 */
  readonly terminateModeQueue: ('resolve' | 'defer' | 'reject' | 'throw')[] = [];
  /** `terminateMode` が `reject` のときの失敗の中身(Error でない値も渡せる)。呼ぶたびに同じものを返す。 */
  terminateFailure: unknown = new Error('terminate が失敗した');
  private terminateWaiter: { resolve: (code: number) => void; reject: (reason: unknown) => void } | null = null;
  private readonly queue: number[] = [];
  private readonly listeners = { message: [] as ((m: WorkerResponse) => void)[], error: [] as ((e: Error) => void)[], exit: [] as ((c: number) => void)[] };

  /** 立てている間、`postMessage` がこの例外を投げる(構造化複製の失敗など)。 */
  postError: Error | null;

  constructor(private readonly behavior: { readonly autoStart?: boolean; readonly postError?: Error; readonly onPost?: (worker: FakeZ3Worker) => void } = {}) {
    this.postError = behavior.postError ?? null;
  }

  postMessage(message: CheckRequest): void {
    if (this.postError !== null) throw this.postError;
    this.posted.push(message);
    this.queue.push(message.id);
    if (this.queue.length === 1) this.start();
    this.behavior.onPost?.(this);
  }

  on(event: 'message', listener: (message: WorkerResponse) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'message' | 'error' | 'exit', listener: never): void {
    (this.listeners[event] as unknown[]).push(listener);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    const mode = this.terminateModeQueue.shift() ?? this.terminateMode;
    if (mode === 'throw') throw new Error('terminate が同期に失敗した');
    if (mode === 'reject') return Promise.reject(this.terminateFailure);
    if (mode === 'resolve') return Promise.resolve(1);
    return new Promise<number>((resolve, reject) => {
      this.terminateWaiter = { resolve, reject };
    });
  }

  /** 保留中の `terminate()` を解く。 */
  finishTerminate(): void {
    this.terminateWaiter?.resolve(1);
  }

  /** 保留中の `terminate()` を失敗で解く(Error でない値も渡せる)。 */
  failTerminate(reason: unknown): void {
    this.terminateWaiter?.reject(reason);
  }

  ref(): void {
    this.refs += 1;
  }

  unref(): void {
    this.refs -= 1;
  }

  /** 先頭の問いの処理を始めたと知らせる(`autoStart: false` の worker を手で進めるとき)。 */
  start(): void {
    const id = this.queue[0];
    if (id === undefined || this.behavior.autoStart === false) return;
    this.emit({ type: 'started', id });
  }

  /** 直近に渡された問いに答える。 */
  reply(status: string, extra: { values?: readonly (readonly [string, string])[]; recycle?: boolean; allocBytes?: number; id?: number } = {}): void {
    const id = extra.id ?? this.lastId();
    const message: WorkerResponse = { type: 'reply', id, status, allocBytes: extra.allocBytes ?? 0, recycle: extra.recycle ?? false, ...(extra.values === undefined ? {} : { values: extra.values }) };
    this.emit(message);
    this.finish(id);
  }

  /** 直近に渡された問いが例外で終わったと返す。 */
  fail(message: string, extra: { recycle?: boolean; aborted?: boolean; allocBytes?: number; id?: number } = {}): void {
    const reply: WorkerResponse = { type: 'failure', id: extra.id ?? this.lastId(), message, allocBytes: extra.allocBytes ?? 0, recycle: extra.recycle ?? false, aborted: extra.aborted ?? false };
    this.emit(reply);
    this.finish(reply.id);
  }

  /** worker が `error` で落ちた。 */
  crash(message: string): void {
    for (const listener of this.listeners.error) listener(new Error(message));
  }

  /** worker が答えずに終了した。 */
  exit(code: number): void {
    for (const listener of this.listeners.exit) listener(code);
  }

  /** worker からの message を親に届ける。 */
  emit(message: WorkerResponse): void {
    for (const listener of this.listeners.message) listener(message);
  }

  /** 答えた問いを待ちから外し、次の問いの処理を始める。 */
  private finish(id: number): void {
    const index = this.queue.indexOf(id);
    if (index >= 0) this.queue.splice(index, 1);
    if (index === 0) this.start();
  }

  private lastId(): number {
    const last = this.posted.at(-1);
    if (last === undefined) throw new Error('問いがまだ渡されていない');
    return last.id;
  }
}

/** 作った偽の worker を記録する親。 */
export function hostWithFakes(
  behavior: ConstructorParameters<typeof FakeZ3Worker>[0] = {},
  limits: { readonly startDeadlineMs?: number; readonly terminateDeadlineMs?: number } = {},
): { readonly host: Z3Host; readonly workers: FakeZ3Worker[]; readonly logs: string[] } {
  const workers: FakeZ3Worker[] = [];
  const logs: string[] = [];
  const host = new Z3Host({
    spawn: () => {
      const worker = new FakeZ3Worker(behavior);
      workers.push(worker);
      return worker;
    },
    recycleAboveBytes: 1000,
    log: (line) => logs.push(line),
    ...limits,
  });
  return { host, workers, logs };
}

/** 保留中の Promise の連鎖を流し切る(タイマーは使わない)。 */
export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
