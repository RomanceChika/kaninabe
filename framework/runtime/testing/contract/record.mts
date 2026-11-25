import type { Json } from '@kaninabe/runtime/ports';
import { sentOfQuery } from '../pg/observe.mjs';
import type { PgQueryable } from '../pg/types.mjs';
import type { Sent } from './types.mjs';

/**
 * 通信路の観測(記録するだけの薄い包み)。
 *
 * 契約テストの ① 3 値(DB に届いた名前付き引数)と ④ 再試行しない(要求の回数)は、adapter が通信路に出した
 * 要求を見て判定する。包みは**通信路の呼び出しの入口で**記録する(成功・失敗・例外のどれでも 1 回数える)。
 * 中身は変えない —— 流した要求はそのまま内側に渡る。
 */

/** `fetch` の要求の URL を文字列にする。 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

/**
 * PostgREST への要求を、通信路に出た RPC の呼び出しとして読む。
 *
 * @param input - `fetch` の第 1 引数
 * @param init - `fetch` の第 2 引数
 * @returns 呼んだ RPC と名前付き引数(本文の鍵)。RPC の呼び出しでなければ `null`
 */
export function sentOfRequest(input: RequestInfo | URL, init: RequestInit | undefined): Sent | null {
  const match = /\/rpc\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(new URL(urlOf(input), 'http://localhost').pathname);
  if (match?.[1] === undefined) return null;
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  return { rpc: match[1], args: (body ?? {}) as Readonly<Record<string, Json>> };
}

/**
 * `fetch` を、要求を記録しながら内側に渡す形に包む。
 *
 * @param inner - 内側の `fetch`(偽でも実物でもよい)
 * @param sink - 記録の置き場(出た順に足される)
 * @returns 記録つきの `fetch`
 */
export function recordingFetch(inner: typeof fetch, sink: Sent[]): typeof fetch {
  return (input, init) => {
    const sent = sentOfRequest(input, init);
    if (sent !== null) sink.push(sent);
    return inner(input, init);
  };
}

/**
 * pg の問い合わせの口を、流した文を記録しながら内側に渡す形に包む。
 *
 * @param inner - 内側の口(偽でも実物の `Client` / `Pool` でもよい)
 * @param sink - 記録の置き場(出た順に足される)
 * @returns 記録つきの口
 */
export function recordingQueryable(inner: PgQueryable, sink: Sent[]): PgQueryable {
  return {
    query: (text, values) => {
      const sent = sentOfQuery(text, values);
      if (sent !== null) sink.push(sent);
      return inner.query(text, values);
    },
  };
}
