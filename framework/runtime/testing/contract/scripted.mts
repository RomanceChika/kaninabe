import { DatabaseError } from 'pg';
import type { Json } from '@kaninabe/runtime/ports';
import { REFUSALS } from '@kaninabe/runtime/refusal/refusal-codes';
import type { PgQueryable } from '../pg/types.mjs';
import type { Scenario, Situation } from './types.mjs';

/**
 * 偽の通信路(手元のユニット用)。**状況を、通信路の振る舞いに直す**。
 *
 * 実 DB を使わないので、DB が返すはずのものを**作る**。作るのは通信路の出口だけで、adapter の中身は
 * 差し替えない(モジュールの差し替えはしない)—— PostgREST の adapter には偽の `fetch`(HTTP の応答を返す)を、
 * pg の参照 adapter には偽のクライアント(行を返すか、`DatabaseError` / 接続の失敗を投げる)を差す。
 * 作ったエラーは実物と同じ形(HTTP のエラー本文 `code` / `message` / `details` / `hint`・
 * `DatabaseError` の `code` / `detail` / `hint`・Node のシステムエラーの `code`)にしてある。
 */

/** 通信路の振る舞い(状況から決まる)。 */
export type Scripted =
  | { readonly kind: 'result'; readonly value: Json }
  | { readonly kind: 'error'; readonly sqlstate: string; readonly message: string }
  | { readonly kind: 'network'; readonly code: string | null }
  | { readonly kind: 'mixed_network' };

/** 不変条件違反に使う SQLSTATE(一意制約違反)。 */
const UNIQUE_VIOLATION = '23505';

/**
 * 状況を通信路の振る舞いに直す。
 *
 * @param situation - 起こす状況
 * @param scenario - その状況の呼び出しと期待(拒否の操作 ID・SQLSTATE を読む)
 * @param invariantMessage - 制約違反の本文(不変条件に引ける制約名を含む)
 * @returns 通信路の振る舞い
 */
export function scriptOf(situation: Situation, scenario: Scenario, invariantMessage: string): Scripted {
  switch (situation) {
    case 'rows':
      return { kind: 'result', value: [{ id: 'row-1' }] };
    case 'document':
      return { kind: 'result', value: { ok: true } };
    case 'zero_rows':
      return { kind: 'result', value: [] };
    case 'forbidden':
    case 'guard_unsatisfied':
    case 'conflict': {
      const refusal = REFUSALS.find((candidate) => candidate.kind === situation);
      const op = scenario.expected.kind === situation ? scenario.expected.op : '';
      return { kind: 'error', sqlstate: refusal?.code ?? '', message: `${refusal?.prefix ?? ''}${op}` };
    }
    case 'invariant_violated':
      return { kind: 'error', sqlstate: UNIQUE_VIOLATION, message: invariantMessage };
    case 'unexpected':
      return {
        kind: 'error',
        sqlstate: (scenario.expected.kind === 'unknown_failure' ? scenario.expected.sqlstate : null) ?? 'P0001',
        message: 'unexpected failure',
      };
    case 'refused':
      return { kind: 'network', code: 'ECONNREFUSED' };
    case 'dropped':
      return { kind: 'network', code: 'ECONNRESET' };
    case 'timed_out':
      return { kind: 'network', code: null };
    case 'mixed_transport':
      return { kind: 'mixed_network' };
  }
}

/** システムエラーの形の失敗(Node のシステムエラーは文字列の `code` を持つ)。 */
function systemError(code: string): Error {
  return Object.assign(new Error(`syscall ${code}`), { code });
}

/**
 * 独立した試みが接続拒否と切断に分かれた集約(`mixed_transport`)。
 *
 * 片方は送る前に落ち、もう片方は送ったあとに切られたので、全体は「送れたかもしれない」= `unknown` が約束である。
 * **この集約は自分の `code` を持たない**: postgrest-js は直接の原因の `code` しか `details` に書かない
 * (`errors[]` の中身は出ない)ので、Node が先頭の枝の `code` を写す集約では、先頭が接続拒否だと
 * PostgREST 側からは接続拒否にしか見えない。ここでは枝の `code` が見えない形で、pg の参照 adapter に木をたどらせる。
 */
function mixedFailure(): AggregateError {
  return new AggregateError([systemError('ECONNREFUSED'), systemError('ECONNRESET')], 'connect and read failed');
}

/** 接続の層の失敗(fetch が失敗で終わる。原因は `cause` に入る。実物の postgrest-js が読む書式)。 */
function networkFailure(code: string | null): Error {
  if (code === null) return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  return new TypeError('fetch failed', { cause: systemError(code) });
}

/**
 * 振る舞いを返す偽の `fetch`(PostgREST の応答の書式)。
 *
 * @param script - 通信路の振る舞い
 * @returns 振る舞いどおりに応える `fetch`
 */
export function scriptedFetch(script: Scripted): typeof fetch {
  const json = { headers: { 'content-type': 'application/json' } };
  return () => {
    switch (script.kind) {
      case 'result':
        return Promise.resolve(new Response(JSON.stringify(script.value), { status: 200, ...json }));
      case 'error':
        return Promise.resolve(
          new Response(JSON.stringify({ code: script.sqlstate, message: script.message, details: null, hint: null }), { status: 400, ...json }),
        );
      case 'network':
        return Promise.reject(networkFailure(script.code));
      case 'mixed_network':
        return Promise.reject(new TypeError('fetch failed', { cause: mixedFailure() }));
    }
  };
}

/**
 * 振る舞いを返す偽の pg のクライアント(`DatabaseError` と接続の失敗は実物と同じ形)。
 *
 * @param script - 通信路の振る舞い
 * @returns 振る舞いどおりに応える問い合わせの口
 */
export function scriptedQueryable(script: Scripted): PgQueryable {
  return {
    query: () => {
      switch (script.kind) {
        case 'result':
          return Promise.resolve({ rows: [{ result: script.value }] });
        case 'error':
          return Promise.reject(Object.assign(new DatabaseError(script.message, 0, 'error'), { code: script.sqlstate }));
        case 'network':
          return Promise.reject(
            script.code === null
              ? new Error('Query read timeout')
              : Object.assign(new Error(`read ${script.code}`), { code: script.code }),
          );
        case 'mixed_network':
          return Promise.reject(mixedFailure());
      }
    },
  };
}
