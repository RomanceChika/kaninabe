/**
 * Q8(有界性の根拠)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「paging: none の query_spec は bounded_by を持つこと」。
 */

import { describe, expect, it } from 'vitest';
import { boundedByVerifier } from '../../../../lib/query/verifiers/q8-bounded-by.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

describe('Q8 有界性の根拠', () => {
  it('paging: none で bounded_by が無ければエラー', () => {
    const input = queryInput({
      queries: [
        querySpec({
          name: 'entry_draft_list',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          paging: { kind: 'none' },
        }),
      ],
    });

    const findings = boundedByVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'Q8',
      message: 'entry_draft_list は paging: none なのに bounded_by がありません',
    });
  });

  it('paging: none で bounded_by: window があれば通る', () => {
    const input = queryInput({
      queries: [
        querySpec({
          name: 'entry_draft_list',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          paging: { kind: 'none' },
          boundedBy: { kind: 'window' },
        }),
      ],
    });

    expect(boundedByVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('paging: none で bounded_by: parent があれば通る', () => {
    const input = queryInput({
      queries: [
        querySpec({
          name: 'entry_draft_list',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          paging: { kind: 'none' },
          boundedBy: { kind: 'parent', aggregate: 'workshop', reason: '催しあたり capacity で有界' },
        }),
      ],
    });

    expect(boundedByVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('paging: limit(n) なら bounded_by が無くても何も言わない', () => {
    const input = queryInput({
      queries: [
        querySpec({
          name: 'workshop_list',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          paging: { kind: 'limit', max: 50 },
        }),
      ],
    });

    expect(boundedByVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('query_spec が 1 件も無ければ何も言わない', () => {
    expect(boundedByVerifier.verify(queryInput(), QUERY_CTX)).toEqual([]);
  });
});
