/**
 * 受信口(`runInbound`)が、**結果の契約(`CommitOutcome`)どおりに結果を返す**ことのテスト。
 *
 * 確かめるのは、受信口が単発・複合の実行器と同じ分類で通信の失敗を投げ、HTTP の状態(200 / 401 / 400 / 503 / 500)は
 * 変わらないこと。DB への口(`RpcCaller` / `UsecaseRepository`)の結果の読み方は、PostgREST の adapter
 * (`framework/adapters/postgrest`)が自分のテストで見る。
 */

import { describe, expect, it } from 'vitest';
import type { CommitOutcome, RpcReturn } from '@kaninabe/runtime/ports';
import { DbInfrastructureError } from '@kaninabe/runtime/ports';
import type { InboundRoute } from '@kaninabe/runtime/inbound';
import { runInbound } from '@kaninabe/runtime/inbound';

describe('runInbound（受信口は入口ごとの結果の型を保ち、失敗は同じ分類で投げる）', () => {
  /** 受信口の宣言(署名は常に通り、本文は常に読める)。 */
  function route(outcome: CommitOutcome<RpcReturn>, onConflict: 'retry' | 'ack' = 'retry'): InboundRoute {
    return {
      integration: 'stripe',
      emits: 'order.pay',
      onConflict,
      maxBodyBytes: 65_536,
      verify: (_raw, presented) => presented === 'ok',
      receiver: { signatureHeader: 'x-sig', read: (raw) => (raw === 'bad' ? null : { eventId: 'evt_1', payload: { target_id: 't' } }) },
      apply: () => Promise.resolve(outcome),
    };
  }

  /** リクエストを作る。 */
  function request(body = '{}', signature = 'ok'): Request {
    return new Request('https://example.test/hook', { method: 'POST', body, headers: { 'x-sig': signature } });
  }

  /** 受領つきの書けた結果。 */
  function saved(returned: RpcReturn): CommitOutcome<RpcReturn> {
    return { kind: 'saved', receipt: { returned, requestedEffects: [], outbox: 'unknown' } };
  }

  it('applied / duplicate / 読めない本文は 200 で、status に型つきの結果を載せる', async () => {
    const applied = await runInbound(request(), route(saved({ shape: 'document', document: { status: 'applied' } })));
    const duplicate = await runInbound(request(), route(saved({ shape: 'document', document: { status: 'duplicate' } })));
    const unreadable = await runInbound(request(), route(saved({ shape: 'rows', rows: [] })));
    const array = await runInbound(request(), route(saved({ shape: 'document', document: ['duplicate'] })));
    const scalar = await runInbound(request(), route(saved({ shape: 'document', document: null })));

    expect(await Promise.all([applied, duplicate, unreadable, array, scalar].map(async (response) => [response.status, ((await response.json()) as { status: string }).status]))).toEqual([
      [200, 'applied'],
      [200, 'duplicate'],
      [200, 'applied'],
      [200, 'applied'],
      [200, 'applied'],
    ]);
  });

  it('署名不一致は 401・本文を読めなければ 400・不変条件は 500・競合は宣言どおり（retry は 503 / ack は 200 の ignored）', async () => {
    const noSignature = await runInbound(request('{}', 'ng'), route(saved({ shape: 'document', document: {} })));
    const unreadable = await runInbound(request('bad'), route(saved({ shape: 'document', document: {} })));
    const invariant = await runInbound(request(), route({ kind: 'invariant_violated', invariant: 'INV-X-001' }));
    const retry = await runInbound(request(), route({ kind: 'conflict', op: '' }, 'retry'));
    const ack = await runInbound(request(), route({ kind: 'forbidden', op: '' }, 'ack'));

    expect([noSignature, unreadable, invariant, retry, ack].map((response) => response.status)).toEqual([401, 400, 500, 503, 200]);
    expect(await ack.json()).toMatchObject({ status: 'ignored' });
  });

  it('通信の失敗・想定外の失敗は戻り値で受けて DbInfrastructureError として投げる（コミットの状態が残る）', async () => {
    const down = runInbound(request(), route({ kind: 'transport_failed', commit: 'unknown' }));
    const broken = runInbound(request(), route({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501' }));

    await expect(down).rejects.toBeInstanceOf(DbInfrastructureError);
    await expect(down).rejects.toMatchObject({ kind: 'transport_failed', commit: 'unknown' });
    await expect(broken).rejects.toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501' });
  });
});
