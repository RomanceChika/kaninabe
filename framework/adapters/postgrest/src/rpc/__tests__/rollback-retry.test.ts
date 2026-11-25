import { describe, expect, it, vi } from 'vitest';
import { DbInfrastructureError } from '@kaninabe/runtime/ports';
import { ROLLBACK_ATTEMPT_LIMIT, ROLLBACK_BACKOFF_MS, ROLLBACK_SQLSTATES, isCertainRollback, retryRollbacks, retryTableWrites } from '../rollback-retry';
import type { RawRpc, RawTableWrite, RpcResponse, TableWriteSource } from '../rollback-retry';
import { createRpcCaller } from '../rpc.caller';
import { createHandwrittenRpc } from '../handwritten-rpc';
import { dbFailure } from '../rpc-outcome';
import { invariantOf, pgError } from '../../__tests__/fakes/rpc-source';

/**
 * 巻き戻りが確実な失敗のやり直し(`rollback-retry.ts`。点検 19 回目 B19-1・27 回目の決め)と、尽きたときの結末の読み。
 */

/** 答えを順に返す下の口(尽きたら書けた 1 行)。 */
function sequence(...answers: RpcResponse[]): { readonly raw: RawRpc; readonly calls: () => number } {
  let calls = 0;
  const raw: RawRpc = {
    rpc: () => {
      const answer = answers[calls];
      calls += 1;
      return Promise.resolve(answer ?? { data: [{ id: 'w1' }], error: null, status: 200 });
    },
  };
  return { raw, calls: () => calls };
}

const deadlock: RpcResponse = { data: null, error: pgError({ code: '40P01', message: 'deadlock detected' }), status: 500 };
const serialization: RpcResponse = { data: null, error: pgError({ code: '40001', message: 'could not serialize access' }), status: 409 };
const noWait = (): Promise<void> => Promise.resolve();

describe('isCertainRollback(閉じた表)', () => {
  it.each([
    ['40P01(デッドロック)', '40P01', true],
    ['40001(直列化の失敗)', '40001', true],
    ['40003(完了が分からない)は入れない', '40003', false],
    ['40002(制約の違反)は入れない', '40002', false],
    ['23505(一意の違反)', '23505', false],
    ['通信の失敗(code が空)', '', false],
  ] as const)('%s', (_name, code, expected) => {
    expect(isCertainRollback(pgError({ code }))).toBe(expected);
  });

  it('エラーが無ければやり直さない・表は 2 つだけ・上限は 3 回', () => {
    expect(isCertainRollback(null)).toBe(false);
    expect(ROLLBACK_SQLSTATES).toEqual(['40001', '40P01']);
    expect(ROLLBACK_ATTEMPT_LIMIT).toBe(3);
  });
});

describe('retryRollbacks(やり直しの口)', () => {
  it('巻き戻りが確実な失敗はやり直し、書けたらその応答を返す(関数名と引数は同じものを送り直す)', async () => {
    const names: string[] = [];
    const raw: RawRpc = {
      rpc: (name, args) => {
        names.push(`${name}:${JSON.stringify(args)}`);
        return Promise.resolve(names.length === 1 ? deadlock : { data: [{ id: 'w1' }], error: null, status: 200 });
      },
    };
    const response = await retryRollbacks(raw, noWait).rpc('apply_widget', { p_id: 'w1' });
    expect(response).toEqual({ data: [{ id: 'w1' }], error: null, status: 200 });
    expect(names).toEqual(['apply_widget:{"p_id":"w1"}', 'apply_widget:{"p_id":"w1"}']);
  });

  it('表の外の失敗・書けた応答はやり直さない', async () => {
    for (const answer of [{ data: null, error: pgError({ code: '23505' }), status: 409 }, { data: [], error: null }] as const) {
      const { raw, calls } = sequence(answer);
      expect(await retryRollbacks(raw, noWait).rpc('x', {})).toBe(answer);
      expect(calls()).toBe(1);
    }
  });

  it('上限まで負け続けたら最後の失敗を返す(送るのは 3 回)', async () => {
    const { raw, calls } = sequence(deadlock, serialization, deadlock, deadlock);
    expect(await retryRollbacks(raw, noWait).rpc('x', {})).toBe(deadlock);
    expect(calls()).toBe(ROLLBACK_ATTEMPT_LIMIT);
  });

  it('待ちは 25ms・50ms に揺らぎ(最大 25ms 未満)を足す', async () => {
    const waits: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    const jitters = [0, 0.999];
    const { raw } = sequence(deadlock, deadlock, deadlock);
    await retryRollbacks(raw, sleep, () => jitters.shift() ?? 0).rpc('x', {});
    expect(waits).toEqual([ROLLBACK_BACKOFF_MS, ROLLBACK_BACKOFF_MS * 2 + 24]);
  });

  it('呼び出しの例外はやり直さず、そのまま投げる(送ったあとかもしれない)', async () => {
    let calls = 0;
    const raw: RawRpc = {
      rpc: () => {
        calls += 1;
        return Promise.reject(new Error('socket hang up'));
      },
    };
    await expect(retryRollbacks(raw, noWait).rpc('x', {})).rejects.toThrow('socket hang up');
    expect(calls).toBe(1);
  });

  it('既定の待ちは本物のタイマー(短い)', async () => {
    vi.useFakeTimers();
    try {
      const { raw, calls } = sequence(deadlock);
      const pending = retryRollbacks(raw, undefined, () => 0).rpc('x', {});
      await vi.advanceTimersByTimeAsync(ROLLBACK_BACKOFF_MS);
      await pending;
      expect(calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('尽きたときの結末(書けていない一時的な失敗。押し直しの冪等と噛み合う)', () => {
  it('実行計画の口は、尽きたデッドロックを not_committed の想定外の失敗として返す(HTTP の状態が 500 でも)', async () => {
    const { raw } = sequence(deadlock, deadlock, deadlock);
    const outcome = await createRpcCaller(retryRollbacks(raw, noWait), invariantOf).call('insert_widget', { p_id: 'w1' });
    expect(outcome).toMatchObject({ kind: 'unknown_failure', commit: 'not_committed', sqlstate: '40P01' });
  });

  it('手書きの口も、尽きた直列化の失敗を not_committed で投げる', async () => {
    const { raw } = sequence(serialization, serialization, serialization);
    const rpc = createHandwrittenRpc<{ readonly erase_widget: { readonly Args: object; readonly Returns: unknown } }>(retryRollbacks(raw, noWait), invariantOf);
    await expect(rpc.rpc('erase_widget', {})).rejects.toMatchObject({ kind: 'unknown_failure', commit: 'not_committed', sqlstate: '40001' });
  });

  it('尽きた後の押し直し(同じ冪等キー)は、書けた 1 回目として受け取れる(行は 1 つ)', async () => {
    // 1 回目の要求: 3 回とも負けて書けていない。押し直し: 同じ p_id で送り、DB は 1 回目の行を返す(冪等。ここでは書けた応答で代える)。
    const rows: string[] = [];
    let attempt = 0;
    const raw: RawRpc = {
      rpc: (_name, args) => {
        attempt += 1;
        if (attempt <= ROLLBACK_ATTEMPT_LIMIT) return Promise.resolve(deadlock);
        const id = String(args['p_id']);
        if (!rows.includes(id)) rows.push(id);
        return Promise.resolve({ data: [{ id }], error: null, status: 200 });
      },
    };
    const caller = createRpcCaller(retryRollbacks(raw, noWait), invariantOf);
    expect(await caller.call('insert_widget', { p_id: 'w1' })).toMatchObject({ kind: 'unknown_failure', commit: 'not_committed' });
    expect(rows).toEqual([]);
    expect(await caller.call('insert_widget', { p_id: 'w1' })).toMatchObject({ kind: 'saved' });
    expect(await caller.call('insert_widget', { p_id: 'w1' })).toMatchObject({ kind: 'saved' });
    expect(rows).toEqual(['w1']);
  });
});

describe('dbFailure(手書きのリポジトリの読みの失敗の唯一の作り方)', () => {
  it('SQLSTATE とコミットの状態を欄に残し、DB の文言は cause にだけ入れる', () => {
    const error = pgError({ code: '42501', message: 'permission denied for table members' });
    const failure = dbFailure('members の取得', error);
    expect(failure).toBeInstanceOf(DbInfrastructureError);
    expect(failure).toMatchObject({ where: 'members の取得', kind: 'unknown_failure', sqlstate: '42501' });
    expect(failure.message).not.toContain('permission denied');
    expect(failure.cause).toBe(error);
  });

  it('尽きたやり直しの失敗を投げるときも、書けていないと言う(状態を渡さない読みの口でも)', () => {
    expect(dbFailure('x', pgError({ code: '40P01' }))).toMatchObject({ commit: 'not_committed' });
  });

  it('code が空なら通信の失敗', () => {
    expect(dbFailure('x', pgError({ code: '', details: 'TypeError: fetch failed' }))).toMatchObject({ kind: 'transport_failed', commit: 'unknown' });
  });
});

describe('やり直しの口の入力は object(生の口の形を公開の型に出さない)', () => {
  it('rpc を持たない接続層を渡すと、送るときに TypeError で落ちる(何も送らない)', async () => {
    const source = retryRollbacks({ from: () => ({}) }, noWait);
    await expect(source.rpc('x', {})).rejects.toThrow(TypeError);
  });

  it('from を持たない接続層を渡すと、表の書き込みは送るときに TypeError で落ちる', async () => {
    const writes = retryTableWrites({ rpc: () => Promise.resolve({ data: null, error: null }) }, noWait);
    await expect(writes.insert('jobs', {})).rejects.toThrow('from を持ちません');
  });

  it('実クライアントのメソッドは接続層に束ねて呼ぶ(this を失わない)', async () => {
    const client = {
      prefix: 'api',
      rpc(this: { readonly prefix: string }, name: string): Promise<RpcResponse> {
        return Promise.resolve({ data: `${this.prefix}.${name}`, error: null });
      },
    };
    expect((await retryRollbacks(client, noWait).rpc('f', {})).data).toBe('api.f');
  });
});

describe('retryTableWrites(表の書き込みも同じやり直しの口)', () => {
  /** 答えを順に返す表の書き込みの下の口(送った要求を記録する)。 */
  function tableSequence(...answers: RpcResponse[]): { readonly raw: RawTableWrite; readonly sent: string[] } {
    const sent: string[] = [];
    const next = (label: string): Promise<RpcResponse> => {
      const answer = answers[sent.length];
      sent.push(label);
      return Promise.resolve(answer ?? { data: null, error: null, status: 201 });
    };
    const raw: RawTableWrite = {
      from: (table) => ({
        insert: (row) => next(`insert:${table}:${JSON.stringify(row)}`),
        update: (patch) => ({ in: (column, values) => next(`update:${table}:${JSON.stringify(patch)}:${column}:${JSON.stringify(values)}`) }),
      }),
    };
    return { raw, sent };
  }

  it('足す: 巻き戻りが確実な失敗はやり直し、同じ行を送り直す', async () => {
    const { raw, sent } = tableSequence(deadlock);
    const response = await retryTableWrites(raw, noWait).insert('jobs', { idempotency_key: 'k1' });
    expect(response.error).toBeNull();
    expect(sent).toEqual(['insert:jobs:{"idempotency_key":"k1"}', 'insert:jobs:{"idempotency_key":"k1"}']);
  });

  it('更新: 尽きたら最後の失敗を返す(送るのは 3 回)・表の外の失敗(一意の違反)はやり直さない', async () => {
    const exhausted = tableSequence(serialization, serialization, serialization, serialization);
    const last = await retryTableWrites(exhausted.raw, noWait).updateIn('jobs', { status: 'pending' }, 'id', ['j1']);
    expect(last).toBe(serialization);
    expect(exhausted.sent).toHaveLength(ROLLBACK_ATTEMPT_LIMIT);
    expect(exhausted.sent[0]).toBe('update:jobs:{"status":"pending"}:id:["j1"]');
    const unique: RpcResponse = { data: null, error: pgError({ code: '23505', message: 'duplicate' }), status: 409 };
    const once = tableSequence(unique);
    expect(await retryTableWrites(once.raw, noWait).insert('jobs', {})).toBe(unique);
    expect(once.sent).toHaveLength(1);
  });

  it('型の印の無い口は TableWriteSource にならない', () => {
    const { raw } = tableSequence();
    // @ts-expect-error 型の印の無い口(やり直しを通っていない生の口)は TableWriteSource にならない。
    const bare: TableWriteSource = raw;
    expect(bare).toBe(raw);
    expect(typeof retryTableWrites(raw).insert).toBe('function');
  });
});
