/**
 * Z3 の worker と話す親(`lib/guard/z3-host.ts`)の配線を、偽の worker で固定する。
 *
 * 親は Z3 のハンドルを持たない: 渡すのは SMT-LIB の本文と問いの番号、受け取るのは答えの綴りだけ。
 * 応答しない worker は host の期限で止めて「死亡」にし、残りの問いは待たせず名指しの error にする
 * (成功にも `unknown` にも畳まない)。健全な worker の入れ替えは問いの間の静止点でだけ行う。
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '../../../lib/guard/z3-host.js';
import { flush, hostWithFakes } from '../../helpers/fake-z3-worker.js';

const QUESTION: Question = { context: 'scratch', params: [['timeout', 5000]], sources: ['(assert true)'], withModel: false, deadlineMs: 60_000 };

/** `request` が送る worker 向けの形(host の期限は親が持つので載らない)。 */
const { deadlineMs: _deadline, ...WIRE } = QUESTION;

describe('Z3Host — 問いの受け渡し', () => {
  it('worker は最初の問いまで作らず、問いは番号と本文だけを渡す', async () => {
    const { host, workers } = hostWithFakes();
    expect(workers).toHaveLength(0);

    const answer = host.request(QUESTION);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toEqual([{ type: 'check', id: 1, recycleAboveBytes: 1000, ...WIRE }]);
    workers[0]?.reply('unsat');

    await expect(answer).resolves.toEqual({ status: 'unsat' });
  });

  it('sat の答えはモデルの値の綴りを運び、問いが続いても worker は 1 本を使い回す', async () => {
    const { host, workers } = hostWithFakes();

    const first = host.request({ ...QUESTION, context: 'main', withModel: true });
    workers[0]?.reply('sat', { values: [['x', '3']] });
    const second = host.request(QUESTION);
    workers[0]?.reply('unknown');

    await expect(first).resolves.toEqual({ status: 'sat', values: [['x', '3']] });
    await expect(second).resolves.toEqual({ status: 'unknown' });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted.map((posted) => posted.id)).toEqual([1, 2]);
  });

  it('worker 側の例外は文面つきで問いを error にする', async () => {
    const { host, workers } = hostWithFakes();

    const answer = host.request(QUESTION);
    workers[0]?.fail('(error "line 1: unexpected token")');

    await expect(answer).rejects.toThrow('unexpected token');
  });

  it('答えを待つ間だけ worker がプロセスを生かす(待ちが無ければ手放す)', async () => {
    const { host, workers } = hostWithFakes();

    const answer = host.request(QUESTION);
    expect(workers[0]?.refs).toBe(0);
    workers[0]?.reply('sat');
    await answer;

    expect(workers[0]?.refs).toBe(-1);
  });
});

describe('Z3Host — worker が落ちたとき', () => {
  it('error で落ちたら待っている問いを error にし、セッションは死亡(以降の問いは待たせず error)', async () => {
    const { host, workers } = hostWithFakes();

    const lost = host.request(QUESTION);
    workers[0]?.crash('memory access out of bounds');
    await expect(lost).rejects.toThrow('memory access out of bounds');

    await expect(host.request(QUESTION)).rejects.toThrow('確かめていない');
    expect(workers).toHaveLength(1);
  });

  it('答えずに終了した worker も error にする(終了コードを名指す)', async () => {
    const { host, workers } = hostWithFakes();

    const lost = host.request(QUESTION);
    workers[0]?.exit(1);

    await expect(lost).rejects.toThrow('終了コード 1');
  });
});

describe('Z3Host — host の期限', () => {
  it('期限を超えたら worker を止め、その問いは error(成功にも unknown にもならない)', async () => {
    const { host, workers, logs } = hostWithFakes();

    const answer = host.request({ ...QUESTION, deadlineMs: 5 });

    await expect(answer).rejects.toThrow('Z3 のセッションが期限超過で停止した');
    await expect(answer).rejects.toThrow('この問いは確かめていない');
    expect(workers[0]?.terminated).toBe(true);
    expect(logs.join('\n')).toContain('期限超過');
  });

  it('死亡したセッションの残りの問いは worker を起こさず待たせず error', async () => {
    const { host, workers } = hostWithFakes();
    await expect(host.request({ ...QUESTION, deadlineMs: 5 })).rejects.toThrow('期限超過');

    const rest = [host.request(QUESTION), host.request(QUESTION)];

    for (const answer of rest) await expect(answer).rejects.toThrow('Z3 のセッションが期限超過で停止した');
    expect(workers).toHaveLength(1);
  });

  it('期限切れのとき同じ worker に待っていた別の問いも error(止めた worker の答えは来ない)', async () => {
    const { host } = hostWithFakes();

    const slow = host.request({ ...QUESTION, deadlineMs: 5 });
    const other = host.request(QUESTION);

    await expect(slow).rejects.toThrow('期限超過');
    await expect(other).rejects.toThrow('期限超過');
  });

  it('止めた worker の遅れた答えは無視される', async () => {
    const { host, workers } = hostWithFakes();
    const slow = host.request({ ...QUESTION, deadlineMs: 5 });
    await expect(slow).rejects.toThrow('期限超過');

    workers[0]?.reply('sat', { id: 1 });

    await expect(host.request(QUESTION)).rejects.toThrow('確かめていない');
  });

  it('期限内に答えた問いの期限は取り消される(後から死亡にならない)', async () => {
    const { host, workers } = hostWithFakes();
    const answer = host.request({ ...QUESTION, deadlineMs: 5 });
    workers[0]?.reply('sat');
    await expect(answer).resolves.toEqual({ status: 'sat' });

    const next = host.request(QUESTION);
    workers[0]?.reply('unsat');

    await expect(next).resolves.toEqual({ status: 'unsat' });
    expect(workers[0]?.terminated).toBe(false);
  });

  it('回復は shutdown: 死亡が解け、次の問いは新しい worker で通る', async () => {
    const { host, workers } = hostWithFakes();
    await expect(host.request({ ...QUESTION, deadlineMs: 5 })).rejects.toThrow('期限超過');

    await host.shutdown();
    const next = host.request(QUESTION);
    workers[1]?.reply('sat');

    await expect(next).resolves.toEqual({ status: 'sat' });
    expect(workers).toHaveLength(2);
  });
});

describe('Z3Host — 健全なセッションの入れ替え', () => {
  it('閾値を超えたと知らされたら、問いの間の静止点で worker を入れ替える(次の問いは新しい worker)', async () => {
    const { host, workers, logs } = hostWithFakes();

    const first = host.request(QUESTION);
    workers[0]?.reply('sat', { recycle: true, allocBytes: 2000 });
    await expect(first).resolves.toEqual({ status: 'sat' });
    expect(workers[0]?.terminated).toBe(true);
    expect(logs.join('\n')).toContain('入れ替えた');

    const second = host.request(QUESTION);
    // 新しい worker は、古い worker の terminate が終わってから作られる。
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]?.reply('unsat');
    await expect(second).resolves.toEqual({ status: 'unsat' });
  });

  it('待っている問いがあるうちは入れ替えない(走っている問いの下から取り上げない)', async () => {
    const { host, workers } = hostWithFakes();
    const first = host.request(QUESTION);
    const second = host.request(QUESTION);

    workers[0]?.reply('sat', { recycle: true, id: 1 });
    await expect(first).resolves.toEqual({ status: 'sat' });
    expect(workers[0]?.terminated).toBe(false);

    workers[0]?.reply('sat', { id: 2 });
    await expect(second).resolves.toEqual({ status: 'sat' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('例外で終わった問いの返事で再生を頼まれても、静止点で入れ替える', async () => {
    const { host, workers } = hostWithFakes();

    const failing = host.request(QUESTION);
    workers[0]?.fail('壊れた', { recycle: true });
    await expect(failing).rejects.toThrow('壊れた');

    expect(workers[0]?.terminated).toBe(true);
  });

  it('WASM の abort を知らせる失敗は静止点を待たず、待っていた問いを error で終えて直ちに入れ替える(死亡ではない)', async () => {
    const { host, workers, logs } = hostWithFakes();
    const aborted = host.request(QUESTION);
    const waiting = host.request(QUESTION);

    workers[0]?.fail('Aborted(). Build with -sASSERTIONS for more info.', { recycle: true, aborted: true, allocBytes: 10, id: 1 });

    await expect(aborted).rejects.toThrow('Aborted');
    await expect(waiting).rejects.toThrow('WASM のモジュールが abort した');
    await expect(waiting).rejects.toThrow('この問いは確かめていない');
    expect(workers[0]?.terminated).toBe(true);
    expect(logs.join('\n')).toContain('直ちに入れ替えた');

    // 壊れたモジュールの上では動かさない: 次の問いは新しい worker が答える。
    const next = host.request(QUESTION);
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]?.reply('unsat');
    await expect(next).resolves.toEqual({ status: 'unsat' });
  });

  it('閾値以下なら入れ替えない', async () => {
    const { host, workers } = hostWithFakes();

    const answer = host.request(QUESTION);
    workers[0]?.reply('sat', { allocBytes: 10 });
    await answer;

    expect(workers[0]?.terminated).toBe(false);
  });
});

describe('Z3Host — 閉じる', () => {
  it('shutdown は worker を止め、待っている問いを error にし、次の問いは新しい worker で始まる', async () => {
    const { host, workers } = hostWithFakes();
    const pending = host.request(QUESTION);

    await host.shutdown();

    await expect(pending).rejects.toThrow('閉じた');
    expect(workers[0]?.terminated).toBe(true);
    const next = host.request(QUESTION);
    expect(workers).toHaveLength(2);
    workers[1]?.reply('unsat');
    await expect(next).resolves.toEqual({ status: 'unsat' });
  });

  it('worker を作っていなければ shutdown は何もしない', async () => {
    const { host, workers } = hostWithFakes();

    await host.shutdown();

    expect(workers).toHaveLength(0);
  });
});
