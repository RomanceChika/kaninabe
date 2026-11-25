/**
 * 定型 RPC の口(`createRpcCaller`)のテスト。
 *
 * 1 回の保存で RPC は 1 回だけ呼ぶこと・`p_effects` を要求の写しとして受領に載せる(載せない呼び方もある)こと・
 * 呼び出しが例外で終わっても握りつぶさず通信の失敗として返すことを確かめる。
 */

import { describe, expect, it } from 'vitest';
import { createRpcCaller } from '../rpc.caller';
import { invariantOf, pgError, receiptOfSaved, sourceOf } from '../../__tests__/fakes/rpc-source';

describe('createRpcCaller（定型 RPC の口）', () => {
  it('1 回の保存で RPC は 1 回だけ呼び、p_effects を要求した効果として受領に写す', async () => {
    const { source, calls } = sourceOf({ data: [{ id: 'a' }], error: null });
    const outcome = await createRpcCaller(source, invariantOf).call('create_widget', { p_id: 'a', p_effects: ['notify', 'announce'] });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ name: 'create_widget', args: { p_id: 'a', p_effects: ['notify', 'announce'] } });
    expect(receiptOfSaved(outcome)).toEqual({
      returned: { shape: 'rows', rows: [{ id: 'a' }] },
      requestedEffects: ['notify', 'announce'],
      outbox: 'unknown',
    });
  });

  it('応答の HTTP の状態を分類に渡す(SQLSTATE つきの 4xx は not_committed・状態の無い応答は unknown。点検 25 回目 O25-1)', async () => {
    const failed = pgError({ code: '23514', message: 'new row violates check constraint' });
    const withStatus = await createRpcCaller(sourceOf({ data: null, error: failed, status: 400 }).source, invariantOf).call('f', { p_id: 'a' });
    const withoutStatus = await createRpcCaller(sourceOf({ data: null, error: failed }).source, invariantOf).call('f', { p_id: 'a' });

    expect(withStatus).toMatchObject({ kind: 'unknown_failure', commit: 'not_committed', sqlstate: '23514' });
    expect(withoutStatus).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '23514' });
  });

  it('p_effects が無い・配列でない・文字列以外を含むときは、文字列の効果だけを要求の写しにする', async () => {
    const none = receiptOfSaved(await createRpcCaller(sourceOf({ data: [{}], error: null }).source, invariantOf).call('f', { p_id: 'a' }));
    const scalar = receiptOfSaved(await createRpcCaller(sourceOf({ data: [{}], error: null }).source, invariantOf).call('f', { p_effects: 'notify' }));
    const mixed = receiptOfSaved(await createRpcCaller(sourceOf({ data: [{}], error: null }).source, invariantOf).call('f', { p_effects: ['notify', 1, null] }));

    expect([none.requestedEffects, scalar.requestedEffects, mixed.requestedEffects]).toEqual([[], [], ['notify']]);
  });

  it('再送の読み直し（同じキー・既存の結果）でも outbox は unknown のまま・requestedEffects は要求の写しで「積んだ」とは言わない', async () => {
    // 初回: 積んだ。応答は失われた。再送: 同じキーなので既存の行を読み直しただけで、何も積んでいない。
    // どちらも DB の戻り値は同じ行になる —— 戻り値から「積んだか」は区別できない。
    const existing = { data: [{ id: 'a', state: 'sent' }], error: null };
    const args = { p_id: 'a', p_effects: ['notify'] };
    const first = receiptOfSaved(await createRpcCaller(sourceOf(existing).source, invariantOf).call('transition_widget', args));
    const resend = receiptOfSaved(await createRpcCaller(sourceOf(existing).source, invariantOf).call('transition_widget', args));
    // 効果を要求しない再送は、要求の写しが空になるだけで outbox は変わらない。
    const resendWithout = receiptOfSaved(await createRpcCaller(sourceOf(existing).source, invariantOf).call('transition_widget', { p_id: 'a' }));

    expect(resend).toEqual(first);
    expect([first.outbox, resend.outbox, resendWithout.outbox]).toEqual(['unknown', 'unknown', 'unknown']);
    expect(resendWithout.requestedEffects).toEqual([]);
  });

  it('受信口の呼び方（tracksEffects を false にする）では、効果が RPC の本体にあるので受領の requestedEffects は null（空の配列ではない）', async () => {
    // 受信口の生成配線が呼ぶ形そのもの。効果は SQL の本体にあり、引数に p_effects は載らない。
    const args = { p_event_id: 'evt_1', p_actor_id: null, p_payload: { record: {}, target_id: 't' } };
    const caller = createRpcCaller(sourceOf({ data: { status: 'applied' }, error: null }).source, invariantOf);

    const inbound = receiptOfSaved(await caller.call('inbound_billing_hook', args, { tracksEffects: false }));
    const defaulted = receiptOfSaved(await caller.call('inbound_billing_hook', args));
    const explicit = receiptOfSaved(await caller.call('inbound_billing_hook', args, { tracksEffects: true }));

    expect(inbound).toEqual({ returned: { shape: 'document', document: { status: 'applied' } }, requestedEffects: null, outbox: 'unknown' });
    // 既定のままでは「効果を要求しなかった」空の配列になる —— 「積まなかった」と読めるので、載せない RPC は false で呼ぶ。
    expect([defaulted.requestedEffects, explicit.requestedEffects]).toEqual([[], []]);
  });

  it('呼び出しそのものが例外で終わっても、握りつぶさず通信の失敗（コミットは unknown）として返す', async () => {
    const failure = new Error('socket hang up');
    const { source, calls } = sourceOf(failure);
    const outcome = await createRpcCaller(source, invariantOf).call('create_widget', { p_id: 'a' });

    expect(calls).toHaveLength(1);
    expect(outcome).toEqual({ kind: 'transport_failed', commit: 'unknown', cause: failure });
  });
});
