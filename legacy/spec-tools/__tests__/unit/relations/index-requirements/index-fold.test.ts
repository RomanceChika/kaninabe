/**
 * 前方一致の畳み込み(`foldTable`)のテスト。要求元(種類・名前・位置)が畳んだ先に集まること、
 * 並びが決定的であること(query が先・名前順・重複は 1 件)を固定する。
 */

import { describe, expect, it } from 'vitest';
import { foldTable } from '../../../../lib/relations/index-requirements/index-fold.js';
import type { IndexOrigin } from '../../../../lib/relations/index-requirements/index.js';

const origin = (kind: IndexOrigin['kind'], name: string, pointer = name): IndexOrigin => ({ kind, name, location: { file: 'spec.md', pointer } });

describe('foldTable', () => {
  it('短い候補は、長い候補の前方一致なら長い方へ畳み、要求元を集める(query が先・名前順)', () => {
    const folded = foldTable('t', [
      { columns: ['a'], origins: [origin('lookup', 'z_fn')] },
      { columns: ['a', 'b'], origins: [origin('query', 'q_long')] },
      { columns: ['a', 'b', 'c'], origins: [origin('lookup', 'a_fn'), origin('query', 'b_query')] },
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ table: 't', columns: ['a', 'b', 'c'], queries: ['b_query', 'q_long'], lookups: ['a_fn', 'z_fn'] });
    expect(folded[0]?.origins.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(['query:b_query', 'query:q_long', 'lookup:a_fn', 'lookup:z_fn']);
  });

  it('同じ種類・名前の要求元は 1 件に畳み、先に来たものの位置を残す', () => {
    const folded = foldTable('t', [
      { columns: ['a', 'b'], origins: [origin('query', 'q', 'first')] },
      { columns: ['a'], origins: [origin('query', 'q', 'second')] },
    ]);

    expect(folded[0]?.queries).toEqual(['q']);
    expect(folded[0]?.origins).toEqual([origin('query', 'q', 'first')]);
  });

  it('前方一致しない候補は別の索引として残し、同じ列数なら列名の昇順', () => {
    const folded = foldTable('t', [
      { columns: ['b', 'x'], origins: [origin('query', 'q2')] },
      { columns: ['a', 'x'], origins: [origin('query', 'q1')] },
    ]);

    expect(folded.map((entry) => entry.columns.join(','))).toEqual(['a,x', 'b,x']);
  });
});
