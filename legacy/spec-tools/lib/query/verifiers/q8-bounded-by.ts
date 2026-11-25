/**
 * Q8 有界性の根拠チェック。
 *
 * query-spec-writing.md の Q8:「`paging: none`(全件返す宣言)の query_spec は、なぜ有界かを
 * `bounded_by` で宣言していること」。
 *
 * `paging: none` は「件数が業務上有界だと分かっている場合のみ」書ける宣言だが、その「なぜ」を
 * 書かせる場所が無いと、`limit` を付け忘れただけの query_spec と、意図して無制限に育つ心配が
 * 無いと確認済みの query_spec とが仕様の上で見分けられない。`npm run explain` の有界性の一覧
 * (`paging: none` を機械的に洗い出す)と対になる — 洗い出された行それぞれに、人が読める理由が
 * 1 つずつ付くようにする。
 */

import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';

/** Q8: `paging: none` の query_spec に `bounded_by` があるかを検証する。 */
export const boundedByVerifier: QueryVerifier = {
  id: 'Q8',
  title: '有界性の根拠 — paging: none には bounded_by が必須',

  verify(input): Finding[] {
    const findings: Finding[] = [];
    for (const query of input.queries.queries) {
      if (query.paging?.kind !== 'none') continue;
      if (query.boundedBy !== undefined) continue;
      findings.push(
        queryFinding('Q8', {
          message: `${query.name} は paging: none なのに bounded_by がありません`,
          location: query.location,
          suggestion:
            'bounded_by に "window"(via のスコープ条件が実行者 1 人分に絞るため有界)、または ' +
            'parent: {aggregate} と reason: {理由を1行}(親集約1件の子行であり、親側の宣言で ' +
            '有界)のどちらかを書く。無制限に育つ心配があるなら paging: limit(n) に直す',
          counterexample: { query: query.name },
        }),
      );
    }
    return findings;
  },
};
