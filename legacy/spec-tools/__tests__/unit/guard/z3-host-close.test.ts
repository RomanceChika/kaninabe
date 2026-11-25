/**
 * Z3 の親(`lib/guard/z3-host.ts`)が、止めた worker の `terminate()` を**所有する**ことを偽の worker で固定する。
 *
 * 入れ替え・死亡で worker を手放しても、その `terminate()` は終わるまで追跡される: `shutdown()` は全部が終わってから返り、
 * 新しい worker は古い worker の `terminate()` が終わってから作られる。`terminate()` の失敗・返らなさは「止まった」と見なさず、
 * fail-closed の障壁になる(新しい worker を作らない。入れ替えを待っていた問いも新しい問いも error)。障壁を解くのは `shutdown()` だけ。
 * 受け渡し・入れ替えの配線そのものは z3-host.test.ts。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../../../lib/guard/z3-host.js';
import { terminateWithin } from '../../../lib/guard/z3-timing.js';
import { flush, hostWithFakes, type FakeZ3Worker } from '../../helpers/fake-z3-worker.js';

afterEach(() => {
  vi.useRealTimers();
});

const QUESTION: Question = { context: 'scratch', params: [['timeout', 5000]], sources: ['(assert true)'], withModel: false, deadlineMs: 60_000 };

function first(workers: readonly FakeZ3Worker[]): FakeZ3Worker {
  const worker = workers[0];
  if (worker === undefined) throw new Error('worker が作られていない');
  return worker;
}

/** 1 問目に答え(入れ替えを頼む)、手放した worker の `terminate()` が保留のまま残っている状態にする。 */
async function recycledWithPendingTerminate() {
  const fakes = hostWithFakes();
  const answer = fakes.host.request(QUESTION);
  first(fakes.workers).terminateMode = 'defer';
  first(fakes.workers).reply('sat', { recycle: true, allocBytes: 2000 });
  await answer;
  return fakes;
}

describe('Z3Host — 止めた worker の terminate は終わるまで待つ', () => {
  it('入れ替えで手放した worker の terminate が解けるまで、shutdown は返らない', async () => {
    const { host, workers } = await recycledWithPendingTerminate();
    let returned = false;

    const closing = host.shutdown().then(() => (returned = true));
    await flush();
    expect(returned).toBe(false);

    first(workers).finishTerminate();
    await closing;

    expect(returned).toBe(true);
  });

  it('期限超過で死亡にした worker の terminate も、shutdown が待つ(死亡した後の問いは待たずに error)', async () => {
    const { host, workers } = hostWithFakes();
    const slow = host.request({ ...QUESTION, deadlineMs: 5 });
    first(workers).terminateMode = 'defer';
    await expect(slow).rejects.toThrow('期限超過');
    await expect(host.request(QUESTION)).rejects.toThrow('確かめていない');
    let returned = false;

    const closing = host.shutdown().then(() => (returned = true));
    await flush();
    expect(returned).toBe(false);
    first(workers).finishTerminate();
    await closing;

    expect(returned).toBe(true);
  });

  it('いま動いている worker の terminate も shutdown が待つ', async () => {
    const { host, workers } = hostWithFakes();
    const pending = host.request(QUESTION);
    first(workers).terminateMode = 'defer';
    let returned = false;

    const closing = host.shutdown().then(() => (returned = true));
    await expect(pending).rejects.toThrow('閉じた');
    await flush();
    expect(returned).toBe(false);
    first(workers).finishTerminate();
    await closing;

    expect(returned).toBe(true);
  });
});

describe('Z3Host — 新しい worker は古い worker の terminate が終わってから', () => {
  it('入れ替えの最中に来た新しい問いは、古い terminate の完了を待ってから新しい worker で処理される', async () => {
    const { host, workers } = await recycledWithPendingTerminate();

    const next = host.request(QUESTION);
    await flush();
    expect(workers).toHaveLength(1);

    first(workers).finishTerminate();
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]?.reply('unsat');

    await expect(next).resolves.toEqual({ status: 'unsat' });
  });

  it('shutdown と同時に待っていた問いは、閉じた後の worker を作らず error になる', async () => {
    const { host, workers } = await recycledWithPendingTerminate();
    const waiting = host.request(QUESTION);
    await flush();

    const closing = host.shutdown();
    first(workers).finishTerminate();
    await closing;

    await expect(waiting).rejects.toThrow('閉じた');
    expect(workers).toHaveLength(1);
  });

  it('shutdown の最中に来た問いも、全部の terminate を待ってから新しい worker で処理される', async () => {
    const { host, workers } = hostWithFakes();
    void host.request(QUESTION).catch(() => undefined);
    first(workers).terminateMode = 'defer';

    const closing = host.shutdown();
    const next = host.request(QUESTION);
    await flush();
    expect(workers).toHaveLength(1);
    first(workers).finishTerminate();
    await closing;
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]?.reply('sat');

    await expect(next).resolves.toEqual({ status: 'sat' });
  });
});

describe('Z3Host — terminate の失敗と返らなさは shutdown の結果に残る', () => {
  it('terminate が reject したら、入れ替えの後の shutdown がその文面で失敗する(detach を exit と見なさない)', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    await expect(host.shutdown()).rejects.toThrow('Z3 の worker を止められなかった(terminate が失敗した)');
  });

  it('Error でない値で reject しても文面に残る', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).terminateFailure = '生の文字列';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    await expect(host.shutdown()).rejects.toThrow('生の文字列');
  });

  it('いま動いている worker の terminate が失敗しても shutdown の失敗になる', async () => {
    const { host, workers } = hostWithFakes();
    void host.request(QUESTION).catch(() => undefined);
    first(workers).terminateMode = 'reject';

    await expect(host.shutdown()).rejects.toThrow('terminate が失敗した');
  });

  it('terminate が返らなくても上限の時間で打ち切り、返らなかったことを shutdown の失敗にする(永久に待たない)', async () => {
    vi.useFakeTimers();
    const fakes = hostWithFakes({}, { terminateDeadlineMs: 50 });
    const answer = fakes.host.request(QUESTION);
    first(fakes.workers).terminateMode = 'defer';
    first(fakes.workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    const outcome = fakes.host.shutdown().then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    await vi.advanceTimersByTimeAsync(49);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toContain('terminate が 50 ms 返らなかった');
  });

  it('terminate が上限内に解ければ、上限の時計は残らない', async () => {
    vi.useFakeTimers();
    const fakes = hostWithFakes({}, { terminateDeadlineMs: 50 });
    const answer = fakes.host.request(QUESTION);
    first(fakes.workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    await fakes.host.shutdown();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Z3Host — terminate が同期に throw しても reject の連鎖を作らない', () => {
  it('terminateWithin は同期 throw を文面にして返す(reject しない)', async () => {
    await expect(terminateWithin({ terminate: () => { throw new Error('その場で失敗'); } }, 50)).resolves.toBe('その場で失敗');
    await expect(terminateWithin({ terminate: () => { throw '生の文字列'; } }, 50)).resolves.toBe('生の文字列');
  });

  it('入れ替えで手放した worker の terminate が同期に throw したら、障壁が立って以後の問いは error・shutdown も失敗し続ける', async () => {
    const { host, workers, logs } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'throw';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    await expect(host.request(QUESTION)).rejects.toThrow('終了を確認できない');
    expect(workers).toHaveLength(1);
    expect(logs.join('\n')).toContain('terminate が同期に失敗した');
    await expect(host.shutdown()).rejects.toThrow('terminate が同期に失敗した');
    await expect(host.shutdown()).rejects.toThrow('terminate が同期に失敗した');
  });
});

describe('Z3Host — 古い terminate を待った問いは、待った後に状態を見直す', () => {
  it('待つ間に先の問いが作った worker が死亡したら、後の問いはその死亡を引き継いで error になり、新しい worker を重ねない', async () => {
    const fakes: { current: ReturnType<typeof hostWithFakes> | null } = { current: null };
    // 2 本目以降の worker は、問いを受け取った瞬間に落ちる(後の問いの継続が走る前に死亡が決まる)。
    fakes.current = hostWithFakes({ onPost: (worker) => { if (worker !== fakes.current?.workers[0]) worker.crash('受け取った瞬間に落ちた'); } });
    const { host, workers } = fakes.current;
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'defer';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    const earlier = host.request(QUESTION);
    const later = host.request(QUESTION);
    const outcomes = Promise.allSettled([earlier, later]);

    first(workers).finishTerminate();
    const [earlierResult, laterResult] = await outcomes;

    expect(earlierResult?.status).toBe('rejected');
    expect(String((earlierResult as PromiseRejectedResult).reason)).toContain('受け取った瞬間に落ちた');
    expect(laterResult?.status).toBe('rejected');
    expect(String((laterResult as PromiseRejectedResult).reason)).toContain('異常終了');
    expect(workers).toHaveLength(2);
  });
});
