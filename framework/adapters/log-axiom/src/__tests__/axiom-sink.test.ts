/**
 * Axiom へ送る口(`axiom-sink.ts`)のユニットテスト。`fetch` は偽物に差し替える(実ネットワークには出ない)。
 *
 * 確かめるのは —— ①送る URL・ヘッダ・NDJSON の字面 ②応答の状態の読み分け(2xx / 401・403 / 429 / 他の 4xx / 5xx)
 * ③打ち切り・ネットワークの失敗が値で返り、例外が出ない ④失敗の結果にトークンも本文も載らない ⑤宛先の形が崩れていたら送らない
 * ⑥上限を超える件数は束を分ける ⑦環境の値からの組み立て(トークンが無ければ送り先が無い = オプトイン)。
 */

import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@kaninabe/runtime/ports';
import { AXIOM_MAX_BATCH, axiomSinkFromValues, createAxiomSink } from '../axiom-sink';

const TOKEN = 'xaat-0000-SECRET-TOKEN';
const RECORD_A: LogRecord = { level: 'warn', security_event: 'authz_refused', refusal_code: 'role_forbidden', request_id: 'req-1' };
const RECORD_B: LogRecord = { level: 'info', security_event: 'signed_out', actor_id: 'a1', decision: 'session_ended', request_id: null };

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** 呼びを貯めて、決めた応答を返す偽の `fetch`。 */
function fakeFetch(respond: () => Response | Promise<Response>): { readonly fetch: typeof fetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve().then(respond);
  };
  return { fetch: impl as typeof fetch, calls };
}

describe('createAxiomSink: 送り方', () => {
  it('POST で取り込みの URL へ、Bearer と NDJSON の本文を送る(行は変えない)', async () => {
    const fake = fakeFetch(() => new Response('{"ingested":2}', { status: 200 }));
    const sink = createAxiomSink({ token: TOKEN, dataset: 'security-logs', fetch: fake.fetch });

    expect(await sink.send([RECORD_A, RECORD_B])).toEqual({ ok: true });

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.url).toBe('https://api.axiom.co/v1/ingest/security-logs');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/x-ndjson' });
    expect(call?.init.body).toBe(`${JSON.stringify(RECORD_A)}\n${JSON.stringify(RECORD_B)}`);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('EU のホストを選べる', async () => {
    const fake = fakeFetch(() => new Response(null, { status: 200 }));
    await createAxiomSink({ token: TOKEN, dataset: 'd', domain: 'api.eu.axiom.co', fetch: fake.fetch }).send([RECORD_A]);
    expect(fake.calls[0]?.url).toBe('https://api.eu.axiom.co/v1/ingest/d');
  });

  it('上限(10,000 件)を超える件数は束を分け、途中で失敗したらそこで止める', async () => {
    const records = Array.from({ length: AXIOM_MAX_BATCH + 1 }, () => RECORD_A);
    const ok = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: ok.fetch }).send(records)).toEqual({ ok: true });
    expect(ok.calls.map((call) => String(call.init.body).split('\n').length)).toEqual([AXIOM_MAX_BATCH, 1]);

    const failing = fakeFetch(() => new Response(null, { status: 503 }));
    expect(await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: failing.fetch }).send(records)).toEqual({ ok: false, reason: 'server_error' });
    expect(failing.calls).toHaveLength(1);
  });
});

describe('createAxiomSink: 失敗の読み分け(例外は出ない・何も持ち出さない)', () => {
  const STATUS_CASES: readonly { readonly status: number; readonly reason: string }[] = [
    { status: 401, reason: 'unauthorized' },
    { status: 403, reason: 'unauthorized' },
    { status: 429, reason: 'rate_limited' },
    { status: 400, reason: 'rejected' },
    { status: 404, reason: 'rejected' },
    { status: 413, reason: 'rejected' },
    { status: 500, reason: 'server_error' },
    { status: 503, reason: 'server_error' },
  ];
  for (const { status, reason } of STATUS_CASES) {
    it(`HTTP ${status} → ${reason}(応答の本文はどこにも出ない)`, async () => {
      const fake = fakeFetch(() => new Response(`{"message":"${TOKEN} leaked"}`, { status }));
      const result = await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: fake.fetch }).send([RECORD_A]);
      expect(result).toEqual({ ok: false, reason });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    });
  }

  it('打ち切り(TimeoutError / AbortError)→ timeout', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const fake = fakeFetch(() => Promise.reject(Object.assign(new Error(`${TOKEN} took too long`), { name })));
      const result = await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: fake.fetch }).send([RECORD_A]);
      expect(result).toEqual({ ok: false, reason: 'timeout' });
    }
  });

  it('ネットワークの失敗・転送(TypeError)・投げられた文字列 → network(文言は出ない)', async () => {
    for (const thrown of [new TypeError(`fetch failed ${TOKEN}`), 'string thrown', new Error('boom')]) {
      const fake = fakeFetch(() => Promise.reject(thrown));
      const result = await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: fake.fetch }).send([RECORD_A]);
      expect(result).toEqual({ ok: false, reason: 'network' });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it('本文を閉じるのに失敗しても結果は変わらない', async () => {
    const response = new Response('x', { status: 200 });
    Object.defineProperty(response, 'body', { value: { cancel: () => Promise.reject(new Error('cancel failed')) } });
    const fake = fakeFetch(() => response);
    expect(await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: fake.fetch }).send([RECORD_A])).toEqual({ ok: true });
  });

  it('本文の無い応答でも成功は成功', async () => {
    const response = new Response(null, { status: 204 });
    Object.defineProperty(response, 'body', { value: null });
    const fake = fakeFetch(() => response);
    expect(await createAxiomSink({ token: TOKEN, dataset: 'd', fetch: fake.fetch }).send([RECORD_A])).toEqual({ ok: true });
  });
});

describe('createAxiomSink: 宛先の形が崩れていたら送らない(トークンを別のホストへ出さない)', () => {
  const BAD: readonly { readonly name: string; readonly options: { token: string; dataset: string; domain?: string } }[] = [
    { name: 'axiom.co の外のホスト', options: { token: TOKEN, dataset: 'd', domain: 'evil.example.com' } },
    { name: '末尾だけ似たホスト', options: { token: TOKEN, dataset: 'd', domain: 'api.axiom.co.evil.com' } },
    { name: 'パスを含む domain', options: { token: TOKEN, dataset: 'd', domain: 'api.axiom.co/x' } },
    { name: '資格情報を含む domain', options: { token: TOKEN, dataset: 'd', domain: 'evil.com@api.axiom.co' } },
    { name: 'ポートを含む domain', options: { token: TOKEN, dataset: 'd', domain: 'api.axiom.co:8443' } },
    { name: 'データセット名が空', options: { token: TOKEN, dataset: '' } },
    { name: 'データセット名にパスの区切り', options: { token: TOKEN, dataset: '../x' } },
    { name: 'データセット名にクエリ', options: { token: TOKEN, dataset: 'd?x=1' } },
    { name: 'トークンが空白だけ', options: { token: '  ', dataset: 'd' } },
  ];
  for (const { name, options } of BAD) {
    it(`${name} → misconfigured(fetch は 0 回)`, async () => {
      const fake = fakeFetch(() => new Response(null, { status: 200 }));
      const result = await createAxiomSink({ ...options, fetch: fake.fetch }).send([RECORD_A]);
      expect(result).toEqual({ ok: false, reason: 'misconfigured' });
      expect(fake.calls).toHaveLength(0);
    });
  }
});

describe('axiomSinkFromValues: オプトイン', () => {
  it('トークンが無い・空・空白だけなら送り先は無い(null)', () => {
    expect(axiomSinkFromValues({ token: undefined, dataset: 'd', domain: undefined })).toBeNull();
    expect(axiomSinkFromValues({ token: '', dataset: 'd', domain: undefined })).toBeNull();
    expect(axiomSinkFromValues({ token: '   ', dataset: 'd', domain: undefined })).toBeNull();
  });

  it('トークンとデータセットがあれば送り先ができる(ホストの既定は US)', async () => {
    const sink = axiomSinkFromValues({ token: ` ${TOKEN} `, dataset: ' d ', domain: undefined });
    expect(sink).not.toBeNull();
  });

  it('トークンがあるのにデータセットが無ければ、黙って送らず misconfigured を返す口になる', async () => {
    const sink = axiomSinkFromValues({ token: TOKEN, dataset: undefined, domain: undefined });
    expect(await sink?.send([RECORD_A])).toEqual({ ok: false, reason: 'misconfigured' });
  });

  it('ホストの指定は空でなければ使われる(空は既定に戻る)', async () => {
    const eu = fakeFetch(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', eu.fetch);
    try {
      await axiomSinkFromValues({ token: TOKEN, dataset: 'd', domain: 'api.eu.axiom.co' })?.send([RECORD_A]);
      await axiomSinkFromValues({ token: TOKEN, dataset: 'd', domain: '  ' })?.send([RECORD_A]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(eu.calls.map((call) => call.url)).toEqual(['https://api.eu.axiom.co/v1/ingest/d', 'https://api.axiom.co/v1/ingest/d']);
  });
});
