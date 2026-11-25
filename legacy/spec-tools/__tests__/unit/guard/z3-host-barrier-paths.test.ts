/**
 * Z3 の親(`lib/guard/z3-host.ts`)の fail-closed の障壁を、入れ替え以外の経路と並行・例外で固定する(基本の形は z3-host-barrier.test.ts)。
 *
 * 手放す経路は 3 つある(静止点の入れ替え・死亡・abort の直ちの入れ替え)。どれで手放した worker の `terminate()` が失敗しても、
 * 新しい worker は作らない。`shutdown()` が保留を抱えているあいだに来た問いは `shutdown()` の失敗と同じ障壁で終わり、並行する
 * `shutdown()` は(再確認の結果が呼び出しごとに違っても)同じ結果になる(帳簿の `settled()` は確認待ちが空になるまで待つ)。`log` が同期に throw しても、手放した worker の障壁は立ち、帳簿の確認待ちは落ちない。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Z3Host, type Question } from '../../../lib/guard/z3-host.js';
import { TerminateLedger } from '../../../lib/guard/z3-ledger.js';
import { FakeZ3Worker, flush, hostWithFakes } from '../../helpers/fake-z3-worker.js';

afterEach(() => {
  vi.useRealTimers();
});

const QUESTION: Question = { context: 'scratch', params: [['timeout', 5000]], sources: ['(assert true)'], withModel: false, deadlineMs: 60_000 };
const BARRIER = '前の worker の終了を確認できないため、新しい worker を作らない。この問いは確かめていない';

function first(workers: readonly FakeZ3Worker[]): FakeZ3Worker {
  const worker = workers[0];
  if (worker === undefined) throw new Error('worker が作られていない');
  return worker;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('Z3Host — 入れ替え以外の手放し方でも、失敗した terminate の後に新しい worker を作らない', () => {
  it('異常終了(exit)で死亡にした worker の terminate が reject したら、以後の問いは障壁で error・新しい worker は作られない', async () => {
    const { host, workers } = hostWithFakes();
    const lost = host.request(QUESTION).catch(() => undefined);
    first(workers).terminateMode = 'reject';
    first(workers).exit(1);
    await lost;
    await flush();

    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('期限超過で死亡にした worker の terminate が reject したら、以後の問いは障壁で error・新しい worker は作られない', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes();
    const outcome = host.request({ ...QUESTION, deadlineMs: 100 }).then(() => 'resolved', messageOf);
    first(workers).terminateMode = 'reject';

    await vi.advanceTimersByTimeAsync(100);

    await expect(outcome).resolves.toContain('期限超過で停止した');
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort で直ちに入れ替えた worker の terminate が失敗したら、その間に来た問いも以後の問いも障壁で error・新しい worker は作られない', async () => {
    const { host, workers } = hostWithFakes();
    const aborted = host.request(QUESTION).catch(() => undefined);
    first(workers).terminateMode = 'defer';
    first(workers).fail('Aborted()', { aborted: true });
    await aborted;
    const waiting = host.request(QUESTION);
    await flush();

    first(workers).failTerminate(new Error('thread が止まらない'));

    await expect(waiting).rejects.toThrow(BARRIER);
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });
});

describe('Z3Host — shutdown が terminate の保留を抱えているあいだの問いと、並行する shutdown', () => {
  /** 1 問目に答え(入れ替えを頼む)、手放した worker の `terminate()` が保留のまま残っている状態にする。 */
  async function recycledWithPendingTerminate() {
    const fakes = hostWithFakes();
    const answer = fakes.host.request(QUESTION);
    first(fakes.workers).terminateMode = 'defer';
    first(fakes.workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    return fakes;
  }

  it('shutdown の最中に来た問いは、その shutdown の terminate が失敗したら障壁で error になる(新しい worker は作られない)', async () => {
    const { host, workers } = await recycledWithPendingTerminate();
    const closing = host.shutdown().then(() => 'resolved', messageOf);
    const waiting = host.request(QUESTION).then(() => 'resolved', messageOf);
    await flush();

    first(workers).failTerminate(new Error('thread が止まらない'));

    await expect(closing).resolves.toContain('thread が止まらない');
    await expect(waiting).resolves.toBe(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('並行する shutdown 2 本は、確認できなければ両方が同じ文面で reject し、障壁も残る', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    const results = await Promise.all([host.shutdown().then(() => 'resolved', messageOf), host.shutdown().then(() => 'resolved', messageOf)]);

    expect(results[0]).toContain('terminate が失敗した');
    expect(results[1]).toBe(results[0]);
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('並行する shutdown 2 本は、確認できれば両方が resolve し、障壁が消えて次の問いが新しい worker で通る', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    await expect(host.shutdown()).rejects.toThrow('terminate が失敗した');

    first(workers).terminateMode = 'resolve';
    const results = await Promise.all([host.shutdown().then(() => 'resolved', messageOf), host.shutdown().then(() => 'resolved', messageOf)]);

    expect(results).toEqual(['resolved', 'resolved']);
    const next = host.request(QUESTION);
    await flush();
    workers[1]?.reply('unsat');
    await expect(next).resolves.toEqual({ status: 'unsat' });
  });

  it('並行する shutdown 2 本は、1 本目の再確認が成功し 2 本目の再確認が失敗しても、同じ結果になる(両方 reject・障壁は残る)', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    await flush();
    // 再確認の 1 回目はすぐ成功・2 回目は保留のあとで失敗(確認待ちが空になるまで待たないと、1 本目だけが障壁の消えた状態を見て先に resolve する)
    first(workers).terminateModeQueue.push('resolve', 'defer');

    const both = Promise.all([host.shutdown().then(() => 'resolved', messageOf), host.shutdown().then(() => 'resolved', messageOf)]);
    await flush();
    first(workers).failTerminate(new Error('terminate が失敗した'));
    const results = await both;

    expect(results[0]).toContain('terminate が失敗した');
    expect(results[1]).toBe(results[0]);
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('帳簿の settled は、待つ間に足された確認も待つ(先に成功した確認で戻らず、後から失敗した確認の障壁を見る)', async () => {
    const ledger = new TerminateLedger(1000, () => undefined);
    const worker = new FakeZ3Worker();
    worker.terminateModeQueue.push('resolve', 'defer');

    ledger.track(worker);
    const settled = ledger.settled().then(() => ledger.blocked);
    ledger.track(worker);
    await flush();
    worker.failTerminate(new Error('terminate が失敗した'));

    await expect(settled).resolves.toBe(true);
  });
});

describe('Z3Host — log が同期に throw しても障壁は立ち、確認待ちは落ちない', () => {
  /** `log` が常に throw する親(偽 worker を使う)。 */
  function hostWithThrowingLog() {
    const workers: FakeZ3Worker[] = [];
    const host = new Z3Host({
      spawn: () => {
        const worker = new FakeZ3Worker();
        workers.push(worker);
        return worker;
      },
      recycleAboveBytes: 1000,
      log: () => {
        throw new Error('log が壊れている');
      },
    });
    return { host, workers };
  }

  it('入れ替えの手放しで log が throw しても、手放した worker の障壁が立ち、shutdown で解ける', async () => {
    const { host, workers } = hostWithThrowingLog();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    expect(() => first(workers).reply('sat', { recycle: true, allocBytes: 2000 })).toThrow('log が壊れている');
    await answer;
    await flush();

    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
    await expect(host.shutdown()).rejects.toThrow('terminate が失敗した');

    first(workers).terminateMode = 'resolve';
    await expect(host.shutdown()).resolves.toBeUndefined();
  });

  it('死亡で log が throw しても、待っていた問いは error で終わり、手放した worker の障壁が立つ', async () => {
    const { host, workers } = hostWithThrowingLog();
    const waiting = host.request(QUESTION).then(() => 'resolved', messageOf);
    first(workers).terminateMode = 'reject';
    expect(() => first(workers).exit(1)).toThrow('log が壊れている');

    await expect(waiting).resolves.toContain('異常終了');
    await flush();
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('帳簿は log が throw しても確認待ちを落とさない(settled は resolve し、障壁は残る)', async () => {
    const ledger = new TerminateLedger(1000, () => {
      throw new Error('log が壊れている');
    });
    const worker = new FakeZ3Worker();
    worker.terminateMode = 'reject';

    ledger.track(worker);

    await expect(ledger.settled()).resolves.toBeUndefined();
    expect(ledger.blocked).toBe(true);
    expect(ledger.reasons()).toEqual(['terminate が失敗した']);
  });
});
