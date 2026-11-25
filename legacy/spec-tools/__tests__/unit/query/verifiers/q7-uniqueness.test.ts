/**
 * Q7(一意性)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「id と name が全 query_spec を通じて一意である」。
 */

import { describe, expect, it } from 'vitest';
import { uniquenessVerifier } from '../../../../lib/query/verifiers/q7-uniqueness.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

/** name だけ違う 2 本を作る。 */
function twoQueries(nameA: string, nameB: string) {
  return [
    querySpec({ name: nameA, source: 'workshop', for: ['member'], scopeUsed: 'all' }),
    querySpec({
      name: nameB,
      source: 'workshop',
      aggregate: 'other',
      for: ['member'],
      scopeUsed: 'all',
    }),
  ];
}

describe('Q7 一意性', () => {
  it('name が違えば通る', () => {
    const input = queryInput({ queries: twoQueries('workshop_list', 'workshop_archive') });

    expect(uniquenessVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('同じ name の query_spec が 2 つあると id と name の両方で違反になる', () => {
    const input = queryInput({ queries: twoQueries('workshop_list', 'workshop_list') });

    const findings = uniquenessVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.verifier === 'Q7')).toBe(true);
    expect(findings.map((finding) => finding.message)).toEqual([
      'id query-workshop-list が複数の query_spec で使われています',
      'name workshop_list が複数の query_spec で使われています',
    ]);
  });

  it('反例に先行ファイルと重複ファイルを載せる', () => {
    const findings = uniquenessVerifier.verify(
      queryInput({ queries: twoQueries('workshop_list', 'workshop_list') }),
      QUERY_CTX,
    );

    expect(findings[0]?.counterexample).toMatchObject({
      first: 'docs/specs/backend/queries/workshop/workshop_list.md',
      duplicate: 'docs/specs/backend/queries/other/workshop_list.md',
    });
  });

  it('query_spec が 1 件も無ければ何も言わない', () => {
    expect(uniquenessVerifier.verify(queryInput(), QUERY_CTX)).toEqual([]);
  });
});
