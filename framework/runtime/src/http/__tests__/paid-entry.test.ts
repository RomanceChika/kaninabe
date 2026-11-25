/**
 * 有料の口の共通の入口(`paid-entry.ts`)のテスト。
 *
 * 確かめるのは 4 つ —— ①順序(認可 → 本文の上限 → 形 → 枠の消費 → 有料の処理。拒否の手前の段は呼ばれない) ②本文の上限(`Content-Length` が
 * 偽っていても・無くても、上限を超えるバイトを溜めず、超えた時点で読みを打ち切る) ③拒否の応答は固定の語だけで、ログに入力の値が載らない
 * ④上限を持たない口を作れない。
 */

import { describe, expect, it } from 'vitest';
import type { Logger, LogRecord } from '../../operation/ports';
import { readBodyLimited, runPaidEntry } from '../paid-entry';
import type { ConsumeOutcome, PaidEntryOptions } from '../paid-entry';

/** 多要素認証を要求しない製品の束(`mfa` の欄が無い)。 */
const PRODUCT_WITHOUT_MFA: PaidEntryOptions<unknown>['bindings'] = {
  roleTables: { anonymous: 'guest', authenticated: 'member', system: 'system', implications: { staff: ['member'] } },
};

/** 実行者。 */
const ACTOR = '11111111-1111-4111-8111-111111111111';

/** 出力を溜めるログの口。 */
function memoryLogger(): Logger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, write: (record) => records.push(record) };
}

/** 呼び出しの順序を記録する部品一式。 */
function harness(overrides: Partial<PaidEntryOptions<unknown>> = {}, consumed: ConsumeOutcome = 'used') {
  const calls: string[] = [];
  const logger = memoryLogger();
  const options: PaidEntryOptions<unknown> = {
    operation: 'answerSomething',
    maxBodyBytes: 64,
    bindings: PRODUCT_WITHOUT_MFA,
    role: 'member',
    authorize: () => {
      calls.push('authorize');
      return Promise.resolve({ kind: 'ok', actorId: ACTOR });
    },
    parse: (body) => {
      calls.push('parse');
      return typeof body === 'object' && body !== null && 'ok' in body ? { kind: 'ok', value: body } : { kind: 'invalid' };
    },
    consume: () => {
      calls.push('consume');
      return Promise.resolve(consumed);
    },
    handler: ({ actorId, value }) => {
      calls.push('handler');
      return Promise.resolve(Response.json({ actorId, value }));
    },
    logger,
    ...overrides,
  };
  return { calls, logger, options };
}

/** JSON の本文の POST(`Content-Length` は undici が付ける)。 */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x', { method: 'POST', headers, body: JSON.stringify(body) });
}

/** 塊で本文を流す要求(`Content-Length` を付けない = 偽る・省く経路)。引かれた塊の数を持ち帰る。 */
function chunkedRequest(chunks: readonly Uint8Array[], headers: Record<string, string> = {}): { request: Request; pulled: () => number; cancelled: () => boolean } {
  let index = 0;
  let wasCancelled = false;
  // highWaterMark: 0 = 先読みしない(読み手が引いた分だけ pull が呼ばれる。引かれた数がそのまま「読んだ塊の数」になる)。
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        wasCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: stream, duplex: 'half' };
  return { request: new Request('http://localhost/api/x', init), pulled: () => index, cancelled: () => wasCancelled };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('runPaidEntry の順序', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-001
  it('通る要求は 認可 → 形 → 枠の消費 → 有料の処理 の順に進み、処理の応答がそのまま返る', async () => {
    const { calls, options, logger } = harness();

    const response = await runPaidEntry(post({ ok: 1 }), options);

    expect(calls).toEqual(['authorize', 'parse', 'consume', 'handler']);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actorId: ACTOR, value: { ok: 1 } });
    expect(logger.records).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-002
  it('枠を使い切っていれば 429 で、有料の処理は 1 度も呼ばれない(課金の前に断る)', async () => {
    const { calls, options, logger } = harness({ invariant: 'INV-X-001' }, 'exhausted');

    const response = await runPaidEntry(post({ ok: 1 }), options);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'quota_exhausted' });
    expect(calls).toEqual(['authorize', 'parse', 'consume']);
    expect(logger.records).toEqual([
      {
        level: 'warn',
        security_event: 'invariant_refused',
        refusal_code: 'invariant_violated',
        error_kind: 'invariant_violated',
        operation: 'answerSomething',
        actor_id: ACTOR,
        invariant: 'INV-X-001',
        request_id: null,
        message: 'quota_exhausted',
      },
    ]);
  });

  it('不変条件の ID を渡さなければ、枠の拒否のログにも載らない', async () => {
    const { options, logger } = harness({}, 'exhausted');

    await runPaidEntry(post({ ok: 1 }), options);

    expect(logger.records[0]).not.toHaveProperty('invariant');
  });

  it('DB が実行者を拒めば(枠の消費が forbidden)403 で、有料の処理は呼ばれない', async () => {
    const { calls, options, logger } = harness({}, 'forbidden');

    const response = await runPaidEntry(post({ ok: 1 }), options);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(calls).toEqual(['authorize', 'parse', 'consume']);
    expect(logger.records[0]).toMatchObject({ security_event: 'authz_refused', refusal_code: 'role_forbidden', actor_id: ACTOR });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-003
  it('未ログインは 401、役を持たない人は 403 で、本文は 1 バイトも読まず・形も枠も処理も呼ばれない', async () => {
    for (const [outcome, status, actor] of [
      [{ kind: 'unauthenticated' }, 401, null],
      [{ kind: 'forbidden', actorId: ACTOR }, 403, ACTOR],
      [{ kind: 'forbidden' }, 403, null],
    ] as const) {
      const body = chunkedRequest([encode('{"ok":1}')]);
      const { calls, options, logger } = harness({ authorize: () => Promise.resolve(outcome) });

      const response = await runPaidEntry(body.request, options);

      expect(response.status, JSON.stringify(outcome)).toBe(status);
      expect(calls).toEqual([]);
      expect(body.pulled(), '本文を読んでいない').toBe(0);
      expect(logger.records).toEqual([
        {
          level: 'warn',
          security_event: 'authz_refused',
          refusal_code: 'role_forbidden',
          error_kind: 'forbidden',
          operation: 'answerSomething',
          actor_id: actor,
          request_id: null,
        },
      ]);
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-004
  it('壊れた JSON・UTF-8 でない本文・本文なし・形の不正は 400 で、枠は消費しない(使えない入力で枠を減らさない)', async () => {
    const bodies: Request[] = [
      new Request('http://localhost/api/x', { method: 'POST', body: '{broken' }),
      new Request('http://localhost/api/x', { method: 'POST', body: new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]) }),
      new Request('http://localhost/api/x', { method: 'POST', body: '' }),
      new Request('http://localhost/api/x', { method: 'POST' }),
      post({ shape: 'wrong' }),
    ];
    expect(bodies.length).toBeGreaterThan(0);
    for (const request of bodies) {
      const { calls, options, logger } = harness();

      const response = await runPaidEntry(request, options);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_input' });
      expect(calls).not.toContain('consume');
      expect(calls).not.toContain('handler');
      expect(logger.records[0]).toMatchObject({ security_event: 'input_rejected', refusal_code: 'invalid_input' });
      expect(logger.records[0]).not.toHaveProperty('message');
    }
  });

  it('要求の識別子はログに載る(x-request-id)。口の URL・本文・ヘッダの値は載らない', async () => {
    const { options, logger } = harness({}, 'exhausted');

    await runPaidEntry(post({ ok: 'secret-value' }, { 'x-request-id': 'req-123', cookie: 'sb=secret' }), options);

    expect(logger.records[0]?.request_id).toBe('req-123');
    expect(JSON.stringify(logger.records)).not.toMatch(/secret|localhost|api\/x/u);
  });

  it('要求の識別子は配置先の x-vercel-id を先に読む(利用者が送れる x-request-id でログの ID を選べない)', async () => {
    const { options, logger } = harness({}, 'exhausted');

    await runPaidEntry(post({ ok: 1 }, { 'x-request-id': 'forged-0001', 'x-vercel-id': 'iad1::real-9' }), options);

    expect(logger.records[0]?.request_id).toBe('iad1::real-9');
  });

  it.each([
    ['渡さない', undefined],
    ['write を持たない値', {}],
    ['write が関数でない', { write: 'stdout' }],
  ])('ログの口を%s → TypeError で、認可も呼ばない(拒否の行を標準出力だけに残す口を作らない)', async (_title, logger) => {
    const { calls, options } = harness();

    await expect(runPaidEntry(post({ ok: 1 }), { ...options, logger } as unknown as typeof options)).rejects.toThrow(/logger を渡します/);
    expect(calls).toEqual([]);
  });
});

describe('本文の上限(読む前・読みながら)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-005
  it('Content-Length が上限を超えていれば 413 で、本文を 1 バイトも読まず、形も枠も処理も呼ばれない', async () => {
    const body = chunkedRequest([encode('{"ok":1}')], { 'content-length': '65' });
    const { calls, options, logger } = harness();

    const response = await runPaidEntry(body.request, options);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(calls).toEqual(['authorize']);
    expect(body.pulled()).toBe(0);
    expect(logger.records[0]).toMatchObject({ security_event: 'input_rejected', refusal_code: 'invalid_input', message: 'payload_too_large' });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-006
  it('Content-Length が無い(塊で流れる)本文は、上限を超えた最初の塊で読みを打ち切り、残りの塊を引かない', async () => {
    const chunks = [encode('a'.repeat(40)), encode('b'.repeat(40)), encode('c'.repeat(40)), encode('d'.repeat(40))];
    const body = chunkedRequest(chunks);
    const { calls, options } = harness();

    const response = await runPaidEntry(body.request, options);

    expect(response.status).toBe(413);
    expect(calls).toEqual(['authorize']);
    // 40 + 40 = 80 > 64 で打ち切る: 2 つ目までを引き、3 つ目以降は引かない。
    expect(body.pulled()).toBeLessThanOrEqual(2);
    expect(body.cancelled()).toBe(true);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-007
  it('Content-Length が実際より小さく偽られていても、読みながら数えて 413 にする', async () => {
    const body = chunkedRequest([encode('x'.repeat(50)), encode('y'.repeat(50)), encode('z'.repeat(50))], { 'content-length': '10' });
    const { options } = harness();

    const response = await runPaidEntry(body.request, options);

    expect(response.status).toBe(413);
    expect(body.pulled()).toBeLessThanOrEqual(2);
  });

  it('上限ちょうどは通り、1 バイト超えは通らない(境界)', async () => {
    const exact = `{"ok":"${'a'.repeat(64 - 9)}"}`;
    expect(new TextEncoder().encode(exact).byteLength).toBe(64);
    const { options } = harness();

    expect((await runPaidEntry(post(JSON.parse(exact)), options)).status).toBe(200);
    expect((await runPaidEntry(post(JSON.parse(exact.replace('a"', 'aa"'))), options)).status).toBe(413);
  });

  it('マルチバイト文字はバイト数で数える(文字数ではない)', async () => {
    const { options } = harness({ maxBodyBytes: 20 });
    // {"ok":"あいうえお"} = 9 + 15 + 2 = 26 バイト(10 文字ぶんの見かけ)
    const response = await runPaidEntry(post({ ok: 'あいうえお' }), options);

    expect(response.status).toBe(413);
  });
});

describe('readBodyLimited', () => {
  it('Content-Length が数字でない・負・空白つきの値は、宣言として使わず(空白は削る)読みながら数える', async () => {
    for (const header of ['abc', '-5', '1e3', '']) {
      const request = chunkedRequest([encode('{"a":1}')], { 'content-length': header }).request;
      expect(await readBodyLimited(request, 100), header).toEqual({ kind: 'ok', bytes: encode('{"a":1}') });
    }
    const spaced = chunkedRequest([encode('{}')], { 'content-length': ' 500 ' }).request;
    expect(await readBodyLimited(spaced, 100)).toEqual({ kind: 'too_large' });
  });

  it('複数の塊は 1 本につながる。本文なしは missing', async () => {
    const request = chunkedRequest([encode('{"a"'), encode(':1}')]).request;
    expect(await readBodyLimited(request, 100)).toEqual({ kind: 'ok', bytes: encode('{"a":1}') });
    expect(await readBodyLimited(new Request('http://localhost/x', { method: 'POST' }), 100)).toEqual({ kind: 'missing' });
  });
});

describe('上限を持たない口は作れない', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-PAIDENTRY-008
  it('maxBodyBytes が 1 以上の整数でなければ、何も呼ばずに TypeError(上限なしで動く口にしない)', async () => {
    const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
    expect(invalid.length).toBeGreaterThan(0);
    for (const maxBodyBytes of invalid) {
      const { calls, options } = harness({ maxBodyBytes });

      await expect(runPaidEntry(post({ ok: 1 }), options), String(maxBodyBytes)).rejects.toThrow(TypeError);
      expect(calls).toEqual([]);
    }
  });
});
