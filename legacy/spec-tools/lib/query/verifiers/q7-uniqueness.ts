/**
 * Q7 一意性チェック(A5 相当)。
 *
 * query-spec-writing.md の Q7:「`id` と `name` が全 query_spec を通じて一意である」。
 *
 * `name` は実装関数名(`{camelCase(name)}Query`)の元であり、`id` は他の仕様が
 * このクエリを参照するときの名前(`spec_ids`)である。どちらも重複すると、
 * 「その名前がどのクエリを指すか」が決まらなくなり、仕様 ⇔ 実装の対応が 1 対 1 でなくなる。
 */

import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QuerySpec } from '../../model/query/types.js';

/** Q7: id / name が全 query_spec を通じて一意かを検証する。 */
export const uniquenessVerifier: QueryVerifier = {
  id: 'Q7',
  title: '一意性 — id と name が全 query_spec を通じて重複しない',

  verify(input): Finding[] {
    return [
      ...checkKey(input.queries.queries, 'id', (query) => query.id),
      ...checkKey(input.queries.queries, 'name', (query) => query.name),
    ];
  },
};

/**
 * 1 つのキーについて重複を検出する。
 *
 * @param queries 全 query_spec
 * @param key キー名(メッセージ用)
 * @param keyOf そのキーの値を取り出す関数
 */
function checkKey(
  queries: readonly QuerySpec[],
  key: string,
  keyOf: (query: QuerySpec) => string,
): Finding[] {
  const seen = new Map<string, QuerySpec>();
  const findings: Finding[] = [];
  for (const query of queries) {
    const value = keyOf(query);
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, query);
      continue;
    }
    findings.push(duplicateFinding(query, first, key, value));
  }
  return findings;
}

/** 同じ id / name を持つ query_spec が 2 つ以上ある。 */
function duplicateFinding(
  query: QuerySpec,
  first: QuerySpec,
  key: string,
  value: string,
): Finding {
  return queryFinding('Q7', {
    message: `${key} ${value} が複数の query_spec で使われています`,
    location: query.location,
    suggestion:
      `どちらかの name を変えて id も揃える(id は name から導かれる)。` +
      `同じ読み取りが 2 つあるなら 1 本にまとめる(先行: ${first.location.file})`,
    counterexample: { [key]: value, first: first.location.file, duplicate: query.location.file },
  });
}
