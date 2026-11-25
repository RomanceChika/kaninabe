/**
 * 比較の型一致(lib/guard/comparison-typing.ts)。
 *
 * 見るのは「書けてしまうが、TS の評価器が**常に不明**にする組み合わせ」である。
 * 意味の正は `app/src/domain/engine/guard.ts` の `compareValues` / `evaluateIn` であり、
 * ここはその意味を仕様の側で書けなくする検査にあたる(束 ⑳-1b)。
 */

import { describe, expect, it } from 'vitest';
import { parseGuard } from '../../../lib/guard/parser.js';
import { mistypedComparisons, type ValueKindEnv } from '../../../lib/guard/comparison-typing.js';
import type { ValueKind } from '../../../lib/model/field-values.js';

const KINDS: ValueKindEnv = new Map<string, ValueKind>([
  ['doc.state', 'text'],
  ['doc.flag', 'boolean'],
  ['doc.count', 'number'],
  ['doc.opens_at', 'datetime'],
  ['doc.owner_id', 'opaque'],
  ['other.count', 'number'],
  ['actor.id', 'opaque'],
  ['now', 'datetime'],
]);

/** 式 1 本を検査する(パースは通る前提)。 */
function check(source: string): readonly string[] {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`${source}: ${parsed.error.message}`);
  return mistypedComparisons(parsed.expr, KINDS).map((found) => found.reason);
}

describe('boolean の欄', () => {
  it('in で比べたら落とす(TS は常に不明 = 不成立、DB は真になり得る)', () => {
    expect(check('doc.flag in [true]')).toHaveLength(1);
    expect(check('doc.flag not in [true, false]')).toHaveLength(1);
  });

  it('順序で比べたら落とす(Postgres は false < true を持つ)', () => {
    for (const op of ['<', '<=', '>', '>=']) expect(check(`doc.flag ${op} false`)).toHaveLength(1);
  });

  it('等値比較は通る', () => {
    expect(check('doc.flag == true')).toEqual([]);
    expect(check('doc.flag != false')).toEqual([]);
  });
});

describe('uuid / ref の欄', () => {
  it('順序で比べたら落とす', () => {
    expect(check('doc.owner_id < actor.id')).toHaveLength(1);
  });

  it('等値比較は通る', () => {
    expect(check('doc.owner_id == actor.id')).toEqual([]);
  });
});

describe('リテラルの型', () => {
  it('数値の欄を記号と比べたら落とす(SQL は 22P02 で落ちる)', () => {
    expect(check('doc.count == draft')).toHaveLength(1);
  });

  it('日時の欄を ISO 8601 でない記号と比べたら落とす', () => {
    expect(check('doc.opens_at >= draft')).toHaveLength(1);
  });

  it('日時の欄と ISO 8601 のリテラルは通る(日付だけ・小数部つきも)', () => {
    expect(check('doc.opens_at >= 2026-01-01')).toEqual([]);
    expect(check('doc.opens_at >= 2026-01-01T00:00:00Z')).toEqual([]);
    expect(check('doc.opens_at >= 2026-01-01T00:00:00.000Z')).toEqual([]);
  });

  it('text の欄を数値と比べたら落とす(TS は string と number を突き合わせない)', () => {
    expect(check('doc.state == 3')).toHaveLength(1);
  });

  it('in の並びの中の 1 つだけが型違いでも落とす', () => {
    expect(check('doc.count in [1, draft]')).toHaveLength(1);
  });
});

describe('パス右辺', () => {
  it('種別が違う欄どうしの比較は落とす', () => {
    expect(check('doc.count == doc.state')).toHaveLength(1);
  });

  it('同じ種別なら通る', () => {
    expect(check('doc.count < other.count')).toEqual([]);
    expect(check('now >= doc.opens_at')).toEqual([]);
  });
});

describe('種別を知らない欄', () => {
  it('宣言に無いパスには何も言わない(過検出に倒さない)', () => {
    expect(check('ghost.field in [1]')).toEqual([]);
  });
});

describe('and / or / not の下も見る', () => {
  it('入れ子の節に混ざった型違いも拾う', () => {
    expect(check('doc.state == draft and not doc.flag > false')).toHaveLength(1);
  });
});
