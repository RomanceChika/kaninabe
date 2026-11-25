/**
 * Z3 のセッションを所有する worker と話す**親の側**。
 *
 * 親は Z3 のハンドルを持たない。SMT-LIB の本文と問いの番号を `postMessage` で渡し、答え(`sat` / `unsat` /
 * `unknown` / 例外の文面・読み取った値の綴り)だけを受け取る。worker の作り方は注入する(`spawn`):
 * 本物は `z3-worker.ts` を `worker_threads` で起動し、テストは message を返すだけの偽物を渡す。
 *
 * **応答しなくなった worker は止めて「死亡」にする。** Z3 の `timeout` はソルバーの内側の期限で、WASM のヒープが
 * 尽きて落ちた worker には効かない(`check()` が永久に返らない)。親が問いごとに host の期限を持ち、超えたら
 * worker を `terminate()` する。死亡したセッションの問いは待たせず error にする —— 成功にも `unknown` にも畳まない
 * (「確かめていない」を緑にしない)。**期限の起点は、worker がその問いの処理を始めたと知らせた時刻**(`started`)である —— worker は
 * 問いを 1 問ずつ順に解くので、「出した時刻」から数えると、前の問いが長引いただけで健全な後ろの問いが死亡扱いになる。
 * 始まりの知らせが届かない(先頭の問いが、別の長めの待ちを過ぎても始まらない)worker は死んでいるとみて、同じく死亡にする。
 * 回復は `shutdown()`(次の問いは新しい worker = 新しいモジュールの実行環境で始まる)。
 *
 * **健全なセッションの入れ替え。** worker は問いの前に Z3 の割当の見積りを読み、閾値を超えていたら知らせる。親は
 * **問いの間の静止点**(待っている問いが 0)でだけ worker を入れ替える。走っている問いの下から資源を取り上げない。
 *
 * WASM のモジュールが abort した(worker が `aborted` を立てて知らせる)ときは別: 壊れたモジュールの上で後続の問いを動かさないよう、
 * 静止点を待たず、待っている問いを error で終えて直ちに入れ替える。
 *
 * **止めた worker の `terminate()` は親が所有する。** 入れ替え・死亡で worker を手放しても、その `terminate()` の Promise は
 * 追跡し続ける(捨てない)。`shutdown()` は全部が終わってから返り、新しい worker は古い worker の `terminate()` が終わってから作る。
 * `terminate()` の失敗・上限時間(`terminateDeadlineMs`)を超えた返らなさは「止まった」と見なさず、新しい worker を作る許可にしない
 * (待ちは上限で打ち切り、永久には待たない。失敗した終了は下の fail-closed の障壁になる = 古い方と新しい方を重ねない)。
 *
 * **終了を確認できない worker があるあいだは fail-closed の障壁を立てる。** 確認できていない worker が 1 本でもあれば、新しい worker を
 * 作らず、その入れ替えを待っていた問いも新しい問いも error にする(障壁は `admit` の入り口と、止めている worker を待った後に必ず見る)。
 * 時間切れ・`shutdown()` の失敗の文面を読んだことでは解かない。**解くのは `shutdown()` だけ**: 全部の `terminate()` の確認を
 * 試み(確認の定義は `z3-timing.ts` の `terminateWithin`)、確認できたものを障壁から外す。確認できないものが残れば `shutdown()` は失敗のまま・
 * 障壁も残る(次の `shutdown()` がまた試みる)。並行する `shutdown()` は、帳簿の `settled()` が確認待ちの空になるまで待つので同じ結果になる。
 *
 * **`log` が throw したときの伝播は許容する**(`settle` / `replaceBroken` / `die` の `log` は最後に呼ぶので、throw は uncaught exception として出るが、
 * その時点で状態は整っている — 手放した worker は追跡済みで、待っていた問いも終えてある)。
 */

import type { CheckReply, CheckRequest, WorkerRequest, WorkerResponse } from './z3-protocol.js';
import { TerminateLedger } from './z3-ledger.js';
import { MAX_TIMER_MS, START_DEADLINE_MS, TERMINATE_DEADLINE_MS, isTimerRange } from './z3-timing.js';

/** worker の必要な口だけ(`worker_threads` の `Worker` がそのまま満たす)。 */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: WorkerResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
  ref(): void;
  unref(): void;
}

/** 親が worker に頼む 1 問(番号と、再生の閾値は親が付ける)。 */
export type Question = Omit<CheckRequest, 'type' | 'id' | 'recycleAboveBytes'> & {
  /** host の期限(ミリ秒)。超えたら worker を止めてセッションを死亡にする。 */
  readonly deadlineMs: number;
};

/** 1 問の答え(Z3 の答えそのまま)。 */
export type Answer = Pick<CheckReply, 'status' | 'values'>;

/** 親の組み立て。 */
export interface HostOptions {
  /** worker を新しく起動する。 */
  readonly spawn: () => WorkerLike;
  /** Z3 の割当の見積りがこの値(バイト)を超えたら、問いの間で worker を入れ替える。 */
  readonly recycleAboveBytes: number;
  /** 入れ替え・停止を開発時に気づけるよう残す行の出し先。 */
  readonly log: (line: string) => void;
  /**
   * worker が「問いを始めた」と知らせるまでの待ち(ミリ秒。既定 `START_DEADLINE_MS`)。超えたら worker が死んでいるとみて
   * 死亡にする。問いの期限(`deadlineMs`)は、この知らせを受けてから数える。
   */
  readonly startDeadlineMs?: number;
  /** 止めた worker の `terminate()` が返るまでの待ち(ミリ秒。既定 `TERMINATE_DEADLINE_MS`)。超えたら失敗として残す。 */
  readonly terminateDeadlineMs?: number;
}

interface Waiting {
  readonly resolve: (answer: Answer) => void;
  readonly reject: (error: Error) => void;
  readonly deadlineMs: number;
  /** worker が処理を始めたと知らせたか。 */
  started: boolean;
  /** 先頭の問いにだけ張る(始まるまでの待ち → 始まってからの host の期限)。 */
  timer: ReturnType<typeof setTimeout> | null;
}

const MIB = 1024 ** 2;

/** 障壁が立っているときの問いの error(終了を確認できない worker を残したまま、新しい worker を作らない)。 */
const BARRIER_MESSAGE = '前の worker の終了を確認できないため、新しい worker を作らない。この問いは確かめていない';

/**
 * worker を 1 本所有し、問いを順に渡す。worker は最初の問いで起動する(使わなければ作らない)。
 */
export class Z3Host {
  private worker: WorkerLike | null = null;
  private nextId = 0;
  private readonly waiting = new Map<number, Waiting>();
  /** 死亡の理由(死亡していなければ null)。`shutdown()` までこのセッションの問いは全部 error。 */
  private dead: string | null = null;
  private recycleRequested = false;
  /**
   * 手放した worker の `terminate()` の帳簿。**fail-closed の障壁**(`ledger.blocked`): 終了を確認できていない worker があるあいだ、
   * 新しい worker を作らない。外すのは `shutdown()` の再確認が成功したときだけ(時間切れでも、`shutdown()` の失敗の文面を読んでも外れない)。
   */
  private readonly ledger: TerminateLedger;
  /** `shutdown()` のたびに進む世代。古い世代で待っていた問いは、閉じた後の worker を作らない。 */
  private epoch = 0;

  constructor(private readonly options: HostOptions) {
    this.ledger = new TerminateLedger(options.terminateDeadlineMs ?? TERMINATE_DEADLINE_MS, options.log);
    // 範囲外の待ちは組み立ての誤り。丸めて通すと(`setTimeout` は 1 ms にする)最初の問いが即座に死亡になる。
    for (const [name, ms] of [['startDeadlineMs', options.startDeadlineMs], ['terminateDeadlineMs', options.terminateDeadlineMs]] as const)
      if (ms !== undefined && !isTimerRange(ms)) throw new Error(`${name} が範囲外(${ms} ms。0 より大きく ${MAX_TIMER_MS} ms 以下でなければならない)`);
  }

  /**
   * 1 問を worker に渡して答えを待つ。
   *
   * @throws worker が例外で終わった・期限を超えた・止まった・セッションが死亡しているとき(文面つき)
   */
  request(question: Question): Promise<Answer> {
    const { deadlineMs, ...rest } = question;
    // 範囲外の期限は呼び手の誤り。丸めて通すと(`setTimeout` は 1 ms にする)全部の問いが即座に死亡になる。
    if (!isTimerRange(deadlineMs))
      return Promise.reject(new Error(`host の期限が範囲外(${deadlineMs} ms。0 より大きく ${MAX_TIMER_MS} ms 以下でなければならない)。この問いは確かめていない`));
    return this.admit(rest, deadlineMs);
  }

  /**
   * 問いを受け入れる。新しい worker は古い worker の `terminate()` が終わってから作るので、待った後は**状態を見直す**
   * (待つ間に別の問いが worker を作って死亡にしていれば、その死亡を無視して新しい worker を重ねない)。
   */
  private admit(rest: Omit<Question, 'deadlineMs'>, deadlineMs: number): Promise<Answer> {
    if (this.ledger.blocked) return Promise.reject(new Error(BARRIER_MESSAGE));
    if (this.dead !== null) return Promise.reject(new Error(`${this.dead}。この問いは確かめていない`));
    if (this.worker !== null || !this.ledger.settling) return this.submit(rest, deadlineMs);
    const epoch = this.epoch;
    return this.ledger.settled().then(() => (this.epoch === epoch ? this.admit(rest, deadlineMs) : Promise.reject(new Error('Z3 のセッションを閉じた。この問いは確かめていない'))));
  }

  private submit(rest: Omit<Question, 'deadlineMs'>, deadlineMs: number): Promise<Answer> {
    const worker = this.ensureWorker();
    this.nextId += 1;
    const id = this.nextId;
    return new Promise<Answer>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, deadlineMs, started: false, timer: null });
      this.armHead(worker);
      worker.ref();
      try {
        worker.postMessage({ ...rest, type: 'check', id, recycleAboveBytes: this.options.recycleAboveBytes });
      } catch (error) {
        // 渡せなかった(構造化複製の失敗など)。worker は無事なので止めず、この問いだけを error にする。
        this.forget(id);
        if (this.waiting.size === 0) worker.unref();
        reject(new Error(`問いを worker に渡せなかった(${error instanceof Error ? error.message : String(error)})。この問いは確かめていない`));
      }
    });
  }

  /**
   * worker を止めて、セッションを捨てる(死亡も解く。次の問いは新しい worker で始まる)。
   * 入れ替え・死亡で先に手放した worker の `terminate()` も含め、全部が終わってから返る。**障壁を解く唯一の道**:
   * 前に確認できなかった worker の `terminate()` も改めて試み、確認できたものを障壁から外す。
   *
   * @throws 終了を確認できない worker が残ったとき(`terminate()` の失敗・上限時間を超えた返らなさ)。障壁も残る(止まったとは見なさない)
   */
  async shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.dead = null;
    this.recycleRequested = false;
    this.epoch += 1;
    this.rejectAll('Z3 のセッションを閉じた');
    // 前に確認できなかった worker は、ここで改めて確認を試みる(この回に手放す worker は 1 回だけ試す)。
    const earlier = this.ledger.pending();
    if (worker !== null) this.ledger.track(worker);
    for (const stale of earlier) this.ledger.track(stale);
    await this.ledger.settled();
    if (this.ledger.blocked) throw new Error(`Z3 の worker を止められなかった(${this.ledger.reasons().join(' / ')})`);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    const worker = this.options.spawn();
    worker.on('message', (message) => this.onMessage(worker, message));
    worker.on('error', (error) => this.lose(worker, error.message));
    worker.on('exit', (code) => this.lose(worker, `worker が終了した(終了コード ${code})`));
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private onMessage(worker: WorkerLike, message: WorkerResponse): void {
    if (worker !== this.worker) return;
    const waiting = this.waiting.get(message.id);
    if (waiting === undefined) return;
    if (message.type === 'started') {
      // 期限はここから数える(前の問いの所要で後ろの問いが死亡扱いにならない)。
      if (waiting.started) return;
      waiting.started = true;
      this.arm(waiting, waiting.deadlineMs, () => this.expire(worker, waiting.deadlineMs));
      return;
    }
    this.forget(message.id);
    if (message.type === 'failure') waiting.reject(new Error(message.message));
    else waiting.resolve(message.values === undefined ? { status: message.status } : { status: message.status, values: message.values });
    if (message.type === 'failure' && message.aborted) {
      this.replaceBroken(worker);
      return;
    }
    if (message.recycle) this.recycleRequested = true;
    this.armHead(worker);
    this.settle(worker, message.allocBytes);
  }

  /** 待ちから外して、張っていた期限を解く。 */
  private forget(id: number): void {
    const waiting = this.waiting.get(id);
    if (waiting === undefined) return;
    this.waiting.delete(id);
    if (waiting.timer !== null) clearTimeout(waiting.timer);
    waiting.timer = null;
  }

  private arm(waiting: Waiting, ms: number, onTimeout: () => void): void {
    if (waiting.timer !== null) clearTimeout(waiting.timer);
    waiting.timer = setTimeout(onTimeout, ms);
  }

  /**
   * worker は問いを順に解くので、始まりを待つのは先頭の問いだけ。先頭がまだ始まっておらず期限も無ければ、
   * 「始まるまでの待ち」を張る(届かなければ worker が死んでいるとみる。長い前の問いの終わりを待つ後ろの問いには張らない)。
   */
  private armHead(worker: WorkerLike): void {
    const head = this.waiting.values().next().value;
    if (head === undefined || head.started || head.timer !== null) return;
    const ms = this.options.startDeadlineMs ?? START_DEADLINE_MS;
    this.arm(head, ms, () => this.expireStart(worker, ms));
  }

  /** 問いの間の静止点(待っている問いが 0)で、入れ替えを頼まれていれば worker を入れ替える。 */
  private settle(worker: WorkerLike, allocBytes: number): void {
    if (this.waiting.size === 0) worker.unref();
    if (!this.recycleRequested || this.waiting.size > 0) return;
    this.recycleRequested = false;
    this.worker = null;
    // 手放した直後に追跡する(`log` が同期に throw しても、手放した worker の障壁は立つ)。
    this.ledger.track(worker);
    this.options.log(`z3: worker を入れ替えた(worker が入れ替えを求めた。Z3 の割当の見積り ${Math.round(allocBytes / MIB)} MiB・閾値 ${Math.round(this.options.recycleAboveBytes / MIB)} MiB。問いの間の静止点)`);
  }

  /**
   * WASM のモジュールが abort した: 壊れたモジュールの上で後続の問いを動かさない。静止点を待たず、待っている問いを
   * 名指しの error で終えて直ちに worker を入れ替える(死亡ではない。次の問いは古い `terminate()` が終わった後の新しい worker で始まる)。
   */
  private replaceBroken(worker: WorkerLike): void {
    this.worker = null;
    this.recycleRequested = false;
    this.ledger.track(worker);
    this.rejectAll('Z3 の WASM のモジュールが abort した(同じ worker で待っていた問い)。この問いは確かめていない');
    this.options.log('z3: WASM のモジュールが abort したので worker を直ちに入れ替えた(待っていた問いは error)');
  }

  /** host の期限を超えた: worker を止めてセッションを死亡にする。待っている問いは全部 error。 */
  private expire(worker: WorkerLike, deadlineMs: number): void {
    if (worker !== this.worker) return;
    this.die(worker, `Z3 のセッションが期限超過で停止した(host の期限 ${deadlineMs} ms)`);
  }

  /** worker が問いを始めなかった: 起動できていない worker とみて、期限超過と同じく死亡にする。 */
  private expireStart(worker: WorkerLike, ms: number): void {
    if (worker !== this.worker) return;
    this.die(worker, `Z3 のセッションが期限超過で停止した(worker が問いを始めなかった。host の待ち ${ms} ms)`);
  }

  /** worker が落ちた(`error` / `exit`): 同じ worker を信用せず、セッションを死亡にする。 */
  private lose(worker: WorkerLike, reason: string): void {
    if (worker !== this.worker) return;
    this.die(worker, `Z3 のセッションが異常終了した(${reason})`);
  }

  private die(worker: WorkerLike, reason: string): void {
    this.worker = null;
    this.dead = reason;
    this.ledger.track(worker);
    this.rejectAll(`${reason}。この問いは確かめていない`);
    this.options.log(`z3: ${reason}。以降の問いは新しい worker に切り替えず error で終える`);
  }

  private rejectAll(reason: string): void {
    const pending = [...this.waiting.values()];
    this.waiting.clear();
    for (const waiting of pending) {
      if (waiting.timer !== null) clearTimeout(waiting.timer);
      waiting.reject(new Error(reason));
    }
  }
}
