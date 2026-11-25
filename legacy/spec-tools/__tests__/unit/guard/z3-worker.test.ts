/**
 * Z3 の worker の本体(`lib/guard/z3-worker.ts`)の段取りを、`z3-solver` と `parentPort` を偽物にして固定する。
 *
 * 本物の WASM では数えられない 2 点 —— 同時に届いた問いでも `init()` が 1 回しか走らないこと・問いは 1 問ずつ順に
 * 処理され、始まった問いから `started` を返すこと —— と、WASM の abort を入れ替えの合図にすることを見る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckRequest, WorkerResponse } from '../../../lib/guard/z3-protocol.js';

const hoisted = vi.hoisted(() => {
  const handlers: ((message: unknown) => void)[] = [];
  const sent: unknown[] = [];
  return {
    handlers,
    sent,
    port: { on: (_event: string, handler: (message: unknown) => void) => void handlers.push(handler), postMessage: (message: unknown) => {
        if (hoisted.postFailures.value > 0) {
          hoisted.postFailures.value -= 1;
          throw new Error('postMessage が失敗した');
        }
        sent.push(message);
      },
    },
    init: vi.fn(),
    check: vi.fn(),
    allocBytes: { value: 0 },
    postFailures: { value: 0 },
    contexts: [] as string[],
    solved: [] as { params: [string, number][]; sources: string[] }[],
  };
});

vi.mock('node:worker_threads', () => ({ parentPort: hoisted.port }));
vi.mock('z3-solver', () => ({ default: { init: hoisted.init } }));

/** 偽の Z3: 文脈の名前と流し込まれた問いを記録し、`check` はテストが握る。 */
function fakeApi() {
  class Context {
    constructor(name: string) {
      hoisted.contexts.push(name);
    }
    Solver = class {
      private readonly record: { params: [string, number][]; sources: string[] } = { params: [], sources: [] };
      constructor() {
        hoisted.solved.push(this.record);
      }
      set(key: string, value: number): void {
        this.record.params.push([key, value]);
      }
      fromString(source: string): void {
        this.record.sources.push(source);
      }
      check(): Promise<string> {
        return hoisted.check() as Promise<string>;
      }
      model() {
        const decl = { name: () => 'x' };
        return { decls: () => [decl], get: () => ({ toString: () => '3' }) };
      }
    };
  }
  return { Z3: { get_estimated_alloc_size: () => BigInt(hoisted.allocBytes.value) }, Context };
}

function request(id: number, extra: Partial<CheckRequest> = {}): CheckRequest {
  return { type: 'check', id, context: 'scratch', params: [], sources: ['(assert true)'], withModel: false, recycleAboveBytes: 1000, ...extra };
}

/** 親から worker へ message を届ける。 */
function send(message: CheckRequest): void {
  for (const handler of hoisted.handlers) handler(message);
}

/** 保留中の Promise の連鎖を流し切る(タイマーは使わない)。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function sent(): WorkerResponse[] {
  return hoisted.sent as WorkerResponse[];
}

beforeEach(async () => {
  hoisted.handlers.length = 0;
  hoisted.sent.length = 0;
  hoisted.contexts.length = 0;
  hoisted.solved.length = 0;
  hoisted.allocBytes.value = 0;
  hoisted.postFailures.value = 0;
  hoisted.init.mockReset();
  hoisted.check.mockReset();
  hoisted.init.mockImplementation(() => Promise.resolve(fakeApi()));
  vi.resetModules();
  await import('../../../lib/guard/z3-worker.js');
});

describe('z3-worker — 起動の共有と直列化', () => {
  it('同時に届いた 2 問でも init() は 1 回', async () => {
    hoisted.check.mockResolvedValue('unsat');

    send(request(1));
    send(request(2));
    await settle();

    expect(hoisted.init).toHaveBeenCalledTimes(1);
    expect(sent().filter((message) => message.type === 'reply').map((message) => message.id)).toEqual([1, 2]);
  });

  it('init が解ける前に同時 5 問が届いても init() は 1 回(解けた後は同じ API で全部に答える)', async () => {
    let ready: (api: ReturnType<typeof fakeApi>) => void = () => undefined;
    hoisted.init.mockReset();
    hoisted.init.mockReturnValue(new Promise<ReturnType<typeof fakeApi>>((resolve) => (ready = resolve)));
    hoisted.check.mockResolvedValue('unsat');

    for (const id of [1, 2, 3, 4, 5]) send(request(id, { context: id % 2 === 0 ? 'main' : 'scratch' }));
    await settle();
    expect(hoisted.init).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([{ type: 'started', id: 1 }]);

    ready(fakeApi());
    await settle();

    expect(hoisted.init).toHaveBeenCalledTimes(1);
    expect(sent().filter((message) => message.type === 'reply').map((message) => message.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('問いは 1 問ずつ順に処理され、前の問いが終わるまで後ろは始まらない(started も出ない)', async () => {
    let release: (status: string) => void = () => undefined;
    hoisted.check.mockReturnValueOnce(new Promise<string>((resolve) => (release = resolve))).mockResolvedValue('sat');

    send(request(1));
    send(request(2));
    await settle();
    expect(sent()).toEqual([{ type: 'started', id: 1 }]);
    expect(hoisted.solved).toHaveLength(1);

    release('unsat');
    await settle();

    expect(sent().map((message) => `${message.type}:${message.id}`)).toEqual(['started:1', 'reply:1', 'started:2', 'reply:2']);
  });

  it('起動に失敗した問いは failure、覚えずに次の問いがもう一度起動する', async () => {
    hoisted.init.mockReset();
    hoisted.init.mockRejectedValueOnce(new Error('wasm が読めない')).mockImplementation(() => Promise.resolve(fakeApi()));
    hoisted.check.mockResolvedValue('sat');

    send(request(1));
    send(request(2));
    await settle();

    expect(sent().find((message) => message.type === 'failure')).toMatchObject({ id: 1, message: 'wasm が読めない', recycle: false });
    expect(sent().find((message) => message.type === 'reply')).toMatchObject({ id: 2, status: 'sat' });
    expect(hoisted.init).toHaveBeenCalledTimes(2);
  });
});

describe('z3-worker — 問いの解き方', () => {
  it('scratch は問いごとに新しい文脈・main は使い回す。params と本文をそのまま流し込む', async () => {
    hoisted.check.mockResolvedValue('unsat');

    send(request(1, { params: [['timeout', 7]], sources: ['a', 'b'] }));
    send(request(2));
    send(request(3, { context: 'main' }));
    send(request(4, { context: 'main' }));
    await settle();

    expect(hoisted.contexts).toEqual(['scratch-1', 'scratch-2', 'main']);
    expect(hoisted.solved[0]).toEqual({ params: [['timeout', 7]], sources: ['a', 'b'] });
  });

  it('sat でモデルを頼まれたら (名前, 値の綴り) を返し、頼まれなければ返さない', async () => {
    hoisted.check.mockResolvedValue('sat');

    send(request(1, { withModel: true }));
    send(request(2));
    await settle();

    const replies = sent().filter((message) => message.type === 'reply');
    expect(replies[0]).toMatchObject({ id: 1, status: 'sat', values: [['x', '3']] });
    expect(replies[1]).toEqual({ type: 'reply', id: 2, status: 'sat', allocBytes: 0, recycle: false });
  });

  it('割当の見積りが閾値を超えていたら recycle を立てる', async () => {
    hoisted.check.mockResolvedValue('unsat');
    hoisted.allocBytes.value = 5000;

    send(request(1));
    await settle();

    expect(sent().find((message) => message.type === 'reply')).toMatchObject({ allocBytes: 5000, recycle: true });
  });
});

describe('z3-worker — WASM の abort は入れ替えの合図', () => {
  it.each([
    ['Aborted の文面', new Error('Aborted(). Build with -sASSERTIONS for more info.'), true],
    ['RuntimeError の名前', Object.assign(new Error('memory access out of bounds'), { name: 'RuntimeError' }), true],
    ['文面の途中に Aborted を含む普通の失敗(SMT の識別子など)', new Error('unknown constant Aborted_flag'), false],
    ['文面の途中に RuntimeError を含む普通の失敗', new Error('line 1: RuntimeError_kind is not declared'), false],
    ['ふつうの例外', new Error('line 1: unexpected token'), false],
    ['Error でない値(abort の文面)', 'Aborted(OOM)', true],
    ['Error でない値(文面の途中の Aborted)', 'saw Aborted(x)', false],
    ['Error でない値(ふつう)', 'oops', false],
  ])('%s: abort = %s', async (_label, thrown, recycle) => {
    hoisted.check.mockRejectedValue(thrown);

    send(request(1));
    await settle();

    expect(sent().find((message) => message.type === 'failure')).toMatchObject({ id: 1, recycle, aborted: recycle });
  });
});

describe('z3-worker — 親へ送れなかったときもキューは続く', () => {
  it('started を送れなかった問いは failure で終わり(問いは解かない)、後ろの問いは続く', async () => {
    hoisted.check.mockResolvedValue('unsat');
    hoisted.postFailures.value = 1;

    send(request(1));
    send(request(2));
    await settle();

    expect(sent().find((message) => message.type === 'failure')).toMatchObject({ id: 1, message: 'postMessage が失敗した', recycle: false, aborted: false });
    expect(hoisted.check).toHaveBeenCalledTimes(1);
    expect(sent().filter((message) => message.type === 'reply').map((message) => message.id)).toEqual([2]);
  });

  it('failure も送れなかった問いがあっても、キューの連鎖は拒否のままにならず後ろの問いに答える', async () => {
    hoisted.check.mockResolvedValue('unsat');
    hoisted.postFailures.value = 2;

    send(request(1));
    send(request(2));
    await settle();

    expect(sent().map((message) => `${message.type}:${message.id}`)).toEqual(['started:2', 'reply:2']);
  });
});
