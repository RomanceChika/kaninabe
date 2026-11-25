/**
 * 保存の結果の契約（`CommitOutcome`）のテスト。
 *
 * 確かめるのは 3 つ —— 通信の失敗・想定外の失敗が**コミットの状態を失わずに**型つきのエラーとして
 * 出ること（`settle`）／業務の拒否はそのまま通ること／受領は「要求の写し」と「outbox: 不明」であり、
 * **再送の読み直しでも「積んだ」と言わない**こと（`receiptOf`）。
 */

import { describe, expect, it } from 'vitest';
import type { CommitOutcome, RpcReturn } from '../ports';
import { DbInfrastructureError, receiptOf, settle } from '../ports';

/** 行の列を返す RPC の戻り値。 */
const ROWS: RpcReturn = { shape: 'rows', rows: [{ id: 'a' }] };

/** 業務の結果（そのまま通ってよい全種類）。 */
const BUSINESS: readonly CommitOutcome<RpcReturn>[] = [
  { kind: 'saved', receipt: receiptOf(ROWS, ['notify']) },
  { kind: 'conflict', op: 'widget.send' },
  { kind: 'forbidden', op: 'widget.send' },
  { kind: 'guard_unsatisfied', op: '' },
  { kind: 'invariant_violated', invariant: 'INV-WIDGET-001' },
];

/** 捕まえたエラーを `DbInfrastructureError` として返す（投げなかったら失敗）。 */
function caught(run: () => unknown): DbInfrastructureError {
  try {
    run();
  } catch (error) {
    if (error instanceof DbInfrastructureError) return error;
    throw error;
  }
  throw new Error('投げられなかった');
}

describe('settle（業務の結果と、投げる失敗の分け方）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-003
  it('通信の失敗・想定外の失敗は、コミットの状態を欄に残した DbInfrastructureError として投げる', () => {
    const cause = { code: 'PGRST301', message: 'JWT expired', details: 'secret detail', hint: 'secret hint' };

    const notCommitted = caught(() => settle('rpc_a', { kind: 'transport_failed', commit: 'not_committed', cause }));
    expect(notCommitted).toMatchObject({ kind: 'transport_failed', commit: 'not_committed', sqlstate: null, name: 'DbInfrastructureError', where: 'rpc_a' });

    const transport = caught(() => settle('rpc_a', { kind: 'transport_failed', commit: 'unknown' }));
    expect(transport).toMatchObject({ kind: 'transport_failed', commit: 'unknown', sqlstate: null });
    expect(transport.cause).toBeUndefined();

    const unknown = caught(() => settle('rpc_a', { kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501', cause }));
    expect(unknown).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501', where: 'rpc_a' });
    expect(unknown.cause).toBe(cause);
    expect(unknown).toBeInstanceOf(Error);
  });

  it('エラーの文面は呼び出しの名前・種類・コミットの状態・SQLSTATE だけで、DB の文言は載せない（cause にだけ入る）', () => {
    const cause = { code: '42501', message: 'permission denied for table secrets', details: 'detail text', hint: 'hint text' };
    const message = caught(() => settle('rpc_a', { kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501', cause })).message;

    expect(message).toContain('rpc_a');
    expect(message).toContain('unknown_failure');
    expect(message).toContain('unknown');
    expect(message).toContain('42501');
    expect(['permission denied', 'detail text', 'hint text'].filter((leaked) => message.includes(leaked))).toEqual([]);

    const transportMessage = caught(() => settle('rpc_b', { kind: 'transport_failed', commit: 'not_committed' })).message;
    expect(transportMessage).toContain('not_committed');
    expect(transportMessage).not.toContain('SQLSTATE');
  });

  it('書けた結果と業務の拒否は、そのまま（同じ値のまま）通る', () => {
    expect(BUSINESS.every((outcome) => settle('rpc_a', outcome) === outcome)).toBe(true);
  });
});

describe('receiptOf（受領は要求の写しと outbox: 不明）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-004
  it('再送の読み直し（同じキーで既存の結果が返る）でも outbox は unknown のまま・requestedEffects は要求の写しで「積んだ」とは言わない', () => {
    const requested = ['notify', 'announce'];
    // 初回: 積んだ。再送: 既存の行を読み直しただけで何も積んでいない。戻り値(`returned`)は同じになる。
    const first = receiptOf(ROWS, requested);
    const resend = receiptOf(ROWS, requested);

    expect(resend).toEqual(first);
    expect([first, resend].map((receipt) => receipt.outbox)).toEqual(['unknown', 'unknown']);
    expect([first, resend].map((receipt) => receipt.requestedEffects)).toEqual([requested, requested]);
    // 要求しなかった効果は、戻り値が何であっても現れない（引数から「積んだ」を作らない）。
    expect(receiptOf(ROWS, []).requestedEffects).toEqual([]);
    expect(receiptOf({ shape: 'document', document: { status: 'duplicate' } }, []).outbox).toBe('unknown');
  });

  it('要求した効果を追っていない呼び出し（複合 RPC）は null で、「効果を要求しなかった」空の配列と区別される', () => {
    const untracked = receiptOf({ shape: 'document', document: {} }, null);
    const none = receiptOf({ shape: 'document', document: {} }, []);

    expect(untracked.requestedEffects).toBeNull();
    expect(none.requestedEffects).toEqual([]);
    expect(untracked).not.toEqual(none);
    expect([untracked.outbox, none.outbox]).toEqual(['unknown', 'unknown']);
  });

  it('要求の写しは呼び出し側の配列の別名ではなく、あとから変えても受領は動かない', () => {
    const requested = ['notify'];
    const receipt = receiptOf(ROWS, requested);
    requested.push('late');

    expect(receipt.requestedEffects).toEqual(['notify']);
  });
});
