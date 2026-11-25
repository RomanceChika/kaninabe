/**
 * RPC の結末の読み方(`toOutcome` / 手書きの口の `refusalOrThrow`)のテスト。
 *
 * 確かめるのは 3 つ —— ①拒否の分類(UC403 / UC412 / UC409 / 制約違反)が契約を入れる前と同じ ②書けた結果の受領は
 * 要求した効果の写しと `outbox: unknown` ③通信の失敗と想定外の失敗が戻り値になり、PostgREST の文言は契約の欄に出ず
 * `cause` にだけ入る。分類そのものは runtime(`@kaninabe/runtime/refusal`)が持ち、ここは PostgREST のエラーの形を
 * その入力に写す部分を見る。
 */

import { describe, expect, it } from 'vitest';
import { DbInfrastructureError } from '@kaninabe/runtime/ports';
import { refusalOrThrow, toOutcome } from '../rpc-outcome';
import { invariantOf, pgError, receiptOfSaved } from '../../__tests__/fakes/rpc-source';

describe('toOutcome（拒否の分類は契約を入れる前と同じ）', () => {
  it('3 つの errcode は本文の接頭辞から落ちた操作の ID を読み、同じ分類に写る', () => {
    const forbidden = toOutcome(null, pgError({ code: 'UC403', message: 'usecase_forbidden:widget.send x' }), true, [], invariantOf);
    const guard = toOutcome(null, pgError({ code: 'UC412', message: 'usecase_guard:widget.send' }), true, [], invariantOf);
    const conflict = toOutcome(null, pgError({ code: 'UC409', message: 'p', details: 'usecase_conflict:widget.accept' }), false, [], invariantOf);

    expect(forbidden).toEqual({ kind: 'forbidden', op: 'widget.send' });
    expect(guard).toEqual({ kind: 'guard_unsatisfied', op: 'widget.send' });
    expect(conflict).toEqual({ kind: 'conflict', op: 'widget.accept' });
    // 操作が読めなければ空文字（実行器が計画のイベント ID を使う）。
    expect(toOutcome(null, pgError({ code: 'UC409', message: 'no prefix' }), true, [], invariantOf)).toEqual({ kind: 'conflict', op: '' });
  });

  it('制約名が不変条件に引ければ invariant_violated に写る（errcode の種類は問わない）', () => {
    const outcome = toOutcome(
      null,
      pgError({ code: '23505', message: 'duplicate key value violates unique constraint "widgets_title_key"' }),
      true,
      [],
      invariantOf,
    );

    expect(outcome).toEqual({ kind: 'invariant_violated', invariant: 'INV-WIDGET-001' });
  });

  it('エラーが無く 0 行なら、定型 RPC では競合・複合 RPC では書けた（空の配列は 0 行ではない）', () => {
    expect(toOutcome([], null, true, [], invariantOf)).toEqual({ kind: 'conflict', op: '' });
    expect(receiptOfSaved(toOutcome([], null, false, [], invariantOf)).returned).toEqual({ shape: 'rows', rows: [] });
  });

  it('refusalOrThrow は業務の拒否を全部「判断時の前提が崩れた」に寄せ、元の分類を reason に残す(点検 27 回目 B27-1)', () => {
    for (const [code, reason] of [['UC403', 'forbidden'], ['UC412', 'guard_unsatisfied'], ['UC409', 'conflict']] as const) {
      const error = pgError({ code, message: 'usecase_x:widget.send' });
      expect(refusalOrThrow('widget_rpc', error, invariantOf, 400)).toEqual({ refused: { kind: 'conflict' }, reason, error });
    }
    const violated = pgError({ code: '23505', message: 'duplicate key value violates unique constraint "widgets_title_key"' });
    expect(refusalOrThrow('widget_rpc', violated, invariantOf, 409)).toEqual({
      refused: { kind: 'invariant_violated', invariant: 'INV-WIDGET-001' },
      reason: 'invariant_violated',
      error: violated,
    });
  });

  it('refusalOrThrow は拒否でない失敗をコミットの状態つきで投げる(表の外は unknown・通信の失敗は transport_failed)', () => {
    const thrown = (error: ReturnType<typeof pgError>, status?: number): DbInfrastructureError => {
      try {
        refusalOrThrow('widget_rpc', error, invariantOf, status);
      } catch (cause) {
        if (cause instanceof DbInfrastructureError) return cause;
      }
      throw new Error('投げなかった');
    };
    expect(thrown(pgError({ code: 'XX000' }), 500)).toMatchObject({ where: 'widget_rpc', kind: 'unknown_failure', commit: 'unknown', sqlstate: 'XX000' });
    expect(thrown(pgError({ code: '42501' }), 403)).toMatchObject({ kind: 'unknown_failure', commit: 'not_committed', sqlstate: '42501' });
    expect(thrown(pgError({ code: '', details: 'TypeError: fetch failed' }))).toMatchObject({ kind: 'transport_failed', commit: 'unknown' });
  });
});

describe('toOutcome（書けた結果の受領）', () => {
  it('配列は行の列・それ以外は文書として運び、効果は要求の写し・outbox は unknown', () => {
    const rows = receiptOfSaved(toOutcome([{ id: 'a' }], null, true, ['notify'], invariantOf));
    const document = receiptOfSaved(toOutcome({ status: 'applied' }, null, true, [], invariantOf));
    const empty = receiptOfSaved(toOutcome(null, null, false, [], invariantOf));

    expect(rows).toEqual({ returned: { shape: 'rows', rows: [{ id: 'a' }] }, requestedEffects: ['notify'], outbox: 'unknown' });
    expect(document).toEqual({ returned: { shape: 'document', document: { status: 'applied' } }, requestedEffects: [], outbox: 'unknown' });
    expect(empty.returned).toEqual({ shape: 'document', document: null });
  });
});

describe('toOutcome（通信の失敗・想定外の失敗）', () => {
  it('code が空のクライアント側の失敗は通信の失敗。接続の前に落ちたと証明できるときだけ not_committed', () => {
    const refused = toOutcome(
      null,
      pgError({ message: 'TypeError: fetch failed', details: 'Caused by: Error: connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)' }),
      true,
      [],
      invariantOf,
    );
    const dns = toOutcome(null, pgError({ details: 'Caused by: Error: getaddrinfo ENOTFOUND host (ENOTFOUND)' }), true, [], invariantOf);
    const timeout = toOutcome(null, pgError({ hint: 'Request was aborted (timeout or manual cancellation)' }), true, [], invariantOf);
    const reset = toOutcome(null, pgError({ details: 'Caused by: Error: read ECONNRESET (ECONNRESET)' }), true, [], invariantOf);
    const gateway = toOutcome(null, pgError({ message: '<html>502 Bad Gateway</html>' }), true, [], invariantOf);

    expect(refused).toMatchObject({ kind: 'transport_failed', commit: 'not_committed' });
    expect(dns).toMatchObject({ kind: 'transport_failed', commit: 'not_committed' });
    // 送ったあとかもしれない失敗は、証明できないので unknown。
    expect([timeout, reset, gateway].map((outcome) => [outcome.kind, 'commit' in outcome ? outcome.commit : null])).toEqual([
      ['transport_failed', 'unknown'],
      ['transport_failed', 'unknown'],
      ['transport_failed', 'unknown'],
    ]);
  });

  it('details に見える原因コードの印が 1 つでも接続の前の失敗でなければ unknown(接続拒否と切断が混ざるときに not_committed と言わない)', () => {
    const outcomeOf = (details: string | null) => {
      const outcome = toOutcome(null, pgError({ details }), true, [], invariantOf);
      return [outcome.kind, 'commit' in outcome ? outcome.commit : null];
    };

    // 印が全部、接続の前の失敗: 複数あっても not_committed。
    expect(outcomeOf('Caused by: Error: connect (ECONNREFUSED)\nconnect ENOTFOUND host (ENOTFOUND)')).toEqual(['transport_failed', 'not_committed']);
    // 原因が集約: 枝の中身が details に出ない(印は先頭の枝の写し)ので、印が接続拒否だけでも unknown。
    expect(outcomeOf('Caused by: AggregateError:  (ECONNREFUSED)\nconnect ENOTFOUND host (ENOTFOUND)')).toEqual(['transport_failed', 'unknown']);
    expect(outcomeOf('Caused by: AggregateError:  (ECONNREFUSED)')).toEqual(['transport_failed', 'unknown']);
    // 1 つでも別の印が混ざれば unknown(順番は関係ない)。
    expect(outcomeOf('Caused by: Error: connect (ECONNREFUSED)\nread (ECONNRESET)')).toEqual(['transport_failed', 'unknown']);
    expect(outcomeOf('Caused by: Error: read (ECONNRESET)\nconnect (ECONNREFUSED)')).toEqual(['transport_failed', 'unknown']);
    // 印が 1 つも無い(null・括弧の無い綴り・括弧の中が E で始まらない)ときは証明できない。
    expect(outcomeOf(null)).toEqual(['transport_failed', 'unknown']);
    expect(outcomeOf('connect ECONNREFUSED 127.0.0.1:54321')).toEqual(['transport_failed', 'unknown']);
    expect(outcomeOf('at connect (node:net:1194:18)')).toEqual(['transport_failed', 'unknown']);
  });

  // 点検 25 回目 O25-1: DB が組み立てた誤りの応答(SQLSTATE つきの 4xx)は txn が戻っている。閉じた表(runtime の commitOfDbError)に当たり、
  // かつ HTTP の状態が 4xx のときだけ not_committed。5xx・状態の無い応答・表の外の SQLSTATE・PostgREST 自身のコードは unknown のまま。
  it.each([
    ['23514', 400, 'not_committed', '23514'],
    ['P0001', 400, 'not_committed', 'P0001'],
    ['42501', 403, 'not_committed', '42501'],
    ['42883', 404, 'not_committed', '42883'],
    ['23514', 500, 'unknown', '23514'],
    ['23514', undefined, 'unknown', '23514'],
    ['P0001', 200, 'unknown', 'P0001'],
    ['57014', 400, 'unknown', '57014'],
    ['57014', 500, 'unknown', '57014'],
    ['53300', 503, 'unknown', '53300'],
    ['PGRST202', 404, 'unknown', null],
  ] as const)('想定外の失敗 %s・HTTP %s → コミット %s', (code, status, commit, sqlstate) => {
    const outcome = toOutcome(null, pgError({ code, message: 'x' }), true, [], invariantOf, status);
    expect(outcome).toMatchObject({ kind: 'unknown_failure', commit, sqlstate });
  });

  it('それ以外の失敗は想定外。状態を渡さなければコミットは unknown・SQLSTATE の形のときだけ sqlstate を持つ', () => {
    const permission = toOutcome(null, pgError({ code: '42501', message: 'permission denied' }), true, [], invariantOf);
    const timeout = toOutcome(null, pgError({ code: '57014', message: 'canceling statement' }), true, [], invariantOf);
    const postgrest = toOutcome(null, pgError({ code: 'PGRST202', message: 'function not found' }), true, [], invariantOf);

    expect(permission).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501' });
    expect(timeout).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '57014' });
    expect(postgrest).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: null });
  });

  it('PostgREST の message / details / hint は契約の欄に出ず、cause にだけ入る', () => {
    const error = pgError({ code: '42501', message: 'permission denied', details: 'secret detail', hint: 'secret hint' });
    const outcome = toOutcome(null, error, true, [], invariantOf);
    const transport = toOutcome(null, pgError({ message: 'TypeError: fetch failed', details: 'secret detail' }), true, [], invariantOf);

    expect(Object.keys(outcome).sort()).toEqual(['cause', 'commit', 'kind', 'sqlstate']);
    expect(Object.keys(transport).sort()).toEqual(['cause', 'commit', 'kind']);
    expect(outcome).toMatchObject({ cause: error });
    expect(JSON.stringify({ ...outcome, cause: undefined })).not.toMatch(/permission|secret/u);
    expect(JSON.stringify({ ...transport, cause: undefined })).not.toMatch(/fetch failed|secret/u);
  });
});
