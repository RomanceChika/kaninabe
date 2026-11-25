/**
 * L2 網羅スイープ — ③ 読み取り経路 × 実行ロール の行を query_spec から機械的に導出する。
 *
 * 母集合は query_spec の `for`(実行ロール)ごとに 1 行(BACKLOG「query_spec × 実行ロール」)。
 *
 * 「どこで確かめているか」は、そのクエリの `test_cases` を **`for` に並ぶ全ロールの行へ
 * 同じものとして充てる**。query_spec の `test_cases` は action_spec と違って `by_role` を
 * 使う慣習が無く(実装済み query_spec 全件を見てもロール別に書き分けている実例は無い)、
 * ロール単位で証拠を絞り込む機械的な手がかりが存在しないためである。過小に「0 件」と
 * 出すよりも、クエリ単位の事実を正直にそのまま見せる。
 */

import type { QuerySpecModel } from '../../model/query/types.js';
import { toEvidence, type L2Row } from './l2-sweep-types.js';

/**
 * 読み取り経路 × 実行ロールの行を全件組み立てる。
 *
 * @param queries 読み込み済みの query_spec(`available: false` / 省略なら空)
 */
export function buildQueryRows(queries: QuerySpecModel | undefined): L2Row[] {
  if (queries?.available !== true) return [];
  const rows: L2Row[] = [];
  for (const query of queries.queries) {
    const evidence = query.testCases.map((tc) => toEvidence(tc));
    const via = query.via === undefined ? '' : `、via: ${query.via.role}`;
    const detail = `${query.source}(${query.returns}${via})`;
    for (const role of query.forRoles) {
      rows.push({
        section: '読み取り経路',
        subject: `${query.id} × ${role}`,
        aspect: `for: ${role}`,
        detail,
        evidence,
      });
    }
  }
  return rows;
}
