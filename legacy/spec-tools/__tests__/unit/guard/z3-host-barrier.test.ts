/**
 * Z3 の親(`lib/guard/z3-host.ts`)の **fail-closed の障壁**を偽の worker で固定する。
 *
 * 手放した worker の `terminate()` が失敗した・上限を超えて返らなかったときは「止まった」と見なさない: 新しい worker を作らず、
 * 入れ替えを待っていた問いも新しい問いも error にする。時間切れ・`shutdown()` の失敗の文面を読むことでは解けず、解くのは `shutdown()`
 * (再確認に成功したとき)だけ。確認できなければ `shutdown()` は reject のまま・障壁も残る。`terminate()` を待つ配線そのものは z3-host-close.test.ts。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../../../lib/guard/z3-host.js';
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

describe('Z3Host — 終了を確認できない worker があるあいだは fail-closed(新しい worker を作らない)', () => {
  const BARRIER = '前の worker の終了を確認できないため、新しい worker を作らない。この問いは確かめていない';

  it('入れ替えを待っていた問いも新しい問いも、terminate が reject したら error になり、入れ替えの worker は作られない', async () => {
    const { host, workers } = await recycledWithPendingTerminate();
    const waiting = host.request(QUESTION);
    await flush();

    first(workers).failTerminate(new Error('thread が止まらない'));

    await expect(waiting).rejects.toThrow(BARRIER);
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('terminate が上限を超えても同じ: 待っていた問いも新しい問いも error・入れ替えの worker は作られない(時間切れは許可にならない)', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes({}, { terminateDeadlineMs: 50 });
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'defer';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    const waiting = host.request(QUESTION);
    const outcome = waiting.then(() => 'resolved', (error: unknown) => (error instanceof Error ? error.message : String(error)));

    await vi.advanceTimersByTimeAsync(50);

    await expect(outcome).resolves.toBe(BARRIER);
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('障壁の後に shutdown して terminate が解ければ、障壁が消えて次の問いは新しい worker で通る', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);

    first(workers).terminateMode = 'resolve';
    await expect(host.shutdown()).resolves.toBeUndefined();
    const next = host.request(QUESTION);
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]?.reply('unsat');

    await expect(next).resolves.toEqual({ status: 'unsat' });
  });

  it('shutdown でも確認できなければ reject のまま・障壁も残る(確認できるまで何度でも試み、新しい worker は作られない)', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    await expect(host.shutdown()).rejects.toThrow('terminate が失敗した');
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    await expect(host.shutdown()).rejects.toThrow('terminate が失敗した');
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);

    first(workers).terminateMode = 'resolve';
    await expect(host.shutdown()).resolves.toBeUndefined();
    const next = host.request(QUESTION);
    await flush();
    workers[1]?.reply('sat');
    await expect(next).resolves.toEqual({ status: 'sat' });
  });

  it('返らなかった worker の再確認が上限を超えた場合も shutdown は reject のまま・障壁も残る', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes({}, { terminateDeadlineMs: 50 });
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'defer';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;
    await vi.advanceTimersByTimeAsync(50);

    const outcome = host.shutdown().then(() => 'resolved', (error: unknown) => (error instanceof Error ? error.message : String(error)));
    await vi.advanceTimersByTimeAsync(50);

    await expect(outcome).resolves.toContain('terminate が 50 ms 返らなかった');
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });

  it('shutdown の失敗の文面を読んでも(消費しても)障壁は解けない', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request(QUESTION);
    first(workers).terminateMode = 'reject';
    first(workers).reply('sat', { recycle: true, allocBytes: 2000 });
    await answer;

    const message = await host.shutdown().then(() => '', (error: unknown) => (error instanceof Error ? error.message : String(error)));

    expect(message).toContain('terminate が失敗した');
    await expect(host.request(QUESTION)).rejects.toThrow(BARRIER);
    expect(workers).toHaveLength(1);
  });
});
