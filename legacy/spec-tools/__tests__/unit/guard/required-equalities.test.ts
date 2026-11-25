/**
 * 式が必ず成り立たせる等式(lib/guard/required-equalities.ts)。
 *
 * 「2 つの欄が式に現れる」ことと「2 つの欄の等式が必須の項である」ことは別である。後者だけを等式として数える。
 */

import { describe, expect, it } from 'vitest';
import { parseGuard } from '../../../lib/guard/parser.js';
import { conjunctsOfExpr, equatesPaths, requiredEqualities } from '../../../lib/guard/required-equalities.js';

function expr(source: string): Parameters<typeof requiredEqualities>[0] {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.expr;
}

describe('requiredEqualities — トップレベルの and の項になっている パス == パス だけ', () => {
  it.each([
    ['a.x == b.x', [['a.x', 'b.x']]],
    ['a.x == b.x and a.n >= 1', [['a.x', 'b.x']]],
    ['a.n >= 1 and a.x == b.x and b.y == c.y', [['a.x', 'b.x'], ['b.y', 'c.y']]],
    ['a.x == b.x or a.n >= 1', []],
    ['a.x == b.x or a.x == a.x', []],
    ['not a.x == b.x', []],
    ['a.x != b.x', []],
    ['a.x >= b.x', []],
    ['a.x == 1', []],
    ['a.x == b.x and a.y == b.y or a.z == b.z', []],
  ])('%s', (source, expected) => {
    expect(requiredEqualities(expr(source))).toEqual(expected);
  });

  it('conjunctsOfExpr は and だけを開く', () => {
    expect(conjunctsOfExpr(expr('a.x == b.x and a.y == b.y or a.z == b.z'))).toHaveLength(1);
    expect(conjunctsOfExpr(expr('a.n >= 1 and a.m >= 1 and a.k >= 1'))).toHaveLength(3);
    expect(conjunctsOfExpr(expr('not a.n >= 1'))).toHaveLength(1);
  });
});

describe('equatesPaths — 辺の向きは問わず、列が違えば結ばない', () => {
  it('正例と負例', () => {
    const e = expr('a.n >= 1 and b.x == a.x');
    expect(equatesPaths(e, 'a.x', 'b.x')).toBe(true);
    expect(equatesPaths(e, 'b.x', 'a.x')).toBe(true);
    expect(equatesPaths(e, 'a.x', 'b.y')).toBe(false);
    expect(equatesPaths(e, 'a.n', 'b.x')).toBe(false);
  });
});
