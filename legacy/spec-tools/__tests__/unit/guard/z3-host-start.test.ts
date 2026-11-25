/**
 * Z3 の親(`lib/guard/z3-host.ts`)の期限の起点と、呼び手の誤り・渡せなかった問いを、偽の worker で固定する。
 *
 * worker は問いを 1 問ずつ順に解くので、host の期限は「出した時刻」ではなく**worker が処理を始めたと知らせた時刻**から数える
 * (前の問いが長引いただけで健全な後ろの問いが死亡扱いにならない)。受け渡し・落ちた worker・入れ替えは z3-host.test.ts。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../../../lib/guard/z3-host.js';
import { hostWithFakes } from '../../helpers/fake-z3-worker.js';

afterEach(() => {
  vi.useRealTimers();
});

const QUESTION: Question = { context: 'scratch', params: [['timeout', 5000]], sources: ['(assert true)'], withModel: false, deadlineMs: 60_000 };

describe('Z3Host — 期限の起点は worker が問いを始めた時刻', () => {
  it('前の問いが長引いても、後ろの問いは自分が始まるまで期限が進まず死亡にならない', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes();

    const first = host.request({ ...QUESTION, deadlineMs: 1_000 });
    const second = host.request({ ...QUESTION, deadlineMs: 20 });
    // 後ろの問いの期限(20 ms)より長く、前の問いが走り続ける。後ろは始まっていないので期限は進まない。
    await vi.advanceTimersByTimeAsync(800);
    expect(workers[0]?.terminated).toBe(false);

    workers[0]?.reply('sat', { id: 1 });
    await expect(first).resolves.toEqual({ status: 'sat' });
    workers[0]?.reply('unsat', { id: 2 });

    await expect(second).resolves.toEqual({ status: 'unsat' });
    expect(workers[0]?.terminated).toBe(false);
  });

  it('始まった後の問いが期限を超えたら、後ろで待っていた問いも道連れに error', async () => {
    const { host } = hostWithFakes();

    const first = host.request({ ...QUESTION, deadlineMs: 5 });
    const second = host.request({ ...QUESTION, deadlineMs: 60_000 });

    await expect(first).rejects.toThrow('期限超過');
    await expect(second).rejects.toThrow('期限超過');
  });

  it('始まりの知らせが届かない worker は、別の長めの待ちを過ぎたら死亡にする(問いの期限とは別)', async () => {
    const { host, workers, logs } = hostWithFakes({ autoStart: false }, { startDeadlineMs: 5 });

    const answer = host.request({ ...QUESTION, deadlineMs: 60_000 });

    await expect(answer).rejects.toThrow('問いを始めなかった');
    await expect(answer).rejects.toThrow('この問いは確かめていない');
    expect(workers[0]?.terminated).toBe(true);
    expect(logs.join('\n')).toContain('期限超過');
  });

  it('始まりの知らせが届けば、始まるまでの待ちは取り消され、問いの期限に置き換わる', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes({ autoStart: false }, { startDeadlineMs: 30 });

    const answer = host.request({ ...QUESTION, deadlineMs: 60_000 });
    workers[0]?.emit({ type: 'started', id: 1 });
    // 始まりを知らせた。待ちの 30 ms を過ぎても死亡にならない。
    await vi.advanceTimersByTimeAsync(80);
    expect(workers[0]?.terminated).toBe(false);

    workers[0]?.reply('sat');
    await expect(answer).resolves.toEqual({ status: 'sat' });
  });

  it('答えた後に次の問いが先頭になると、その問いに始まるまでの待ちが張られる', async () => {
    const { host, workers } = hostWithFakes({ autoStart: false }, { startDeadlineMs: 5 });
    const first = host.request({ ...QUESTION, deadlineMs: 60_000 });
    const second = host.request({ ...QUESTION, deadlineMs: 60_000 });
    workers[0]?.emit({ type: 'started', id: 1 });
    workers[0]?.reply('sat', { id: 1 });
    await expect(first).resolves.toEqual({ status: 'sat' });

    await expect(second).rejects.toThrow('問いを始めなかった');
  });

  it('同じ問いの始まりの知らせが 2 度来ても期限は張り直さない', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request({ ...QUESTION, deadlineMs: 60_000 });

    workers[0]?.emit({ type: 'started', id: 1 });
    workers[0]?.reply('sat');

    await expect(answer).resolves.toEqual({ status: 'sat' });
  });
});

describe('Z3Host — 組み立ての待ちの範囲', () => {
  it.each(['startDeadlineMs', 'terminateDeadlineMs'] as const)('%s が範囲外(非有限・0 以下・2^31-1 超)なら丸めずに組み立てで失敗する', (name) => {
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 2 ** 31]) expect(() => hostWithFakes({}, { [name]: ms })).toThrow(`${name} が範囲外`);
  });

  it.each(['startDeadlineMs', 'terminateDeadlineMs'] as const)('%s は範囲の上限(2^31 - 1 ms)ちょうどなら通る', (name) => {
    expect(() => hostWithFakes({}, { [name]: 2 ** 31 - 1 })).not.toThrow();
  });
});

describe('Z3Host — 呼び手の誤りと渡せなかった問い', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 2 ** 31])('範囲外の期限(%s)は丸めずに error(worker も起こさない)', async (deadlineMs) => {
    const { host, workers } = hostWithFakes();

    await expect(host.request({ ...QUESTION, deadlineMs })).rejects.toThrow('host の期限が範囲外');

    expect(workers).toHaveLength(0);
  });

  it('範囲の上限(2^31 - 1 ms)ちょうどは通る', async () => {
    const { host, workers } = hostWithFakes();

    const answer = host.request({ ...QUESTION, deadlineMs: 2 ** 31 - 1 });
    workers[0]?.reply('sat');

    await expect(answer).resolves.toEqual({ status: 'sat' });
  });

  it('postMessage が投げたら、その問いだけ error にして期限を解く(健全な worker を後で止めない)', async () => {
    vi.useFakeTimers();
    const { host, workers } = hostWithFakes({ postError: new Error('could not be cloned') });

    const answer = host.request({ ...QUESTION, deadlineMs: 5 });
    await expect(answer).rejects.toThrow('問いを worker に渡せなかった(could not be cloned)');
    // 期限(5 ms)も、始まるまでの待ちも過ぎても、渡せなかった問いのせいで健全な worker は止まらない。
    await vi.advanceTimersByTimeAsync(60_000);

    expect(workers[0]?.terminated).toBe(false);
    expect(workers[0]?.refs).toBe(-1);
  });

  it('渡せなかった問いの前に待っている問いがあるとき、その問いは続く(ref も保つ)', async () => {
    const { host, workers } = hostWithFakes();
    const first = host.request(QUESTION);
    const worker = workers[0];
    if (worker === undefined) throw new Error('worker が作られていない');
    worker.postError = new Error('clone 失敗');

    await expect(host.request(QUESTION)).rejects.toThrow('渡せなかった');
    worker.postError = null;
    expect(worker.refs).toBe(1);
    worker.reply('sat', { id: 1 });

    await expect(first).resolves.toEqual({ status: 'sat' });
  });
});
