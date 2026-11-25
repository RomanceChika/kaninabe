/**
 * GuardServices の組み立てと collectPaths(V2 参照整合の入力)のテスト。
 */

import { describe, expect, it } from 'vitest';
import type { DomainEnv, GuardExpr } from '../../../lib/guard/ast.js';
import { collectPaths, createGuardServices } from '../../../lib/guard/services.js';

const services = createGuardServices();
const EMPTY: DomainEnv = new Map();

/** テスト用: 式をパースして AST を得る。 */
function parse(source: string): GuardExpr {
  const result = services.parse(source);
  if (!result.ok) throw new Error(`パースに失敗: ${result.error.message}`);
  return result.expr;
}

/** テスト用: パスをドット表記に直す。 */
function texts(expr: GuardExpr): string[] {
  return collectPaths(expr).map((p) => p.segments.join('.'));
}

describe('collectPaths', () => {
  it('compare / in / contains の左辺パスを集める', () => {
    expect(texts(parse('workshop.state == accepting and entry.state in [draft, submitted]'))).toEqual(
      ['workshop.state', 'entry.state'],
    );
  });

  it('contains の右辺もパスとして集める', () => {
    expect(texts(parse('workshop.organizer_ids contains actor.id'))).toEqual([
      'workshop.organizer_ids',
      'actor.id',
    ]);
  });

  it('比較の右辺パスも集める', () => {
    expect(texts(parse('entry.performer_id == actor.id'))).toEqual([
      'entry.performer_id',
      'actor.id',
    ]);
    expect(texts(parse('now >= workshop.open_at'))).toEqual(['now', 'workshop.open_at']);
  });

  it('同じパスは 1 つに畳む', () => {
    expect(texts(parse('a.b == 1 and a.b == 2 or a.b != 3'))).toEqual(['a.b']);
  });

  it('not をまたいで集める', () => {
    expect(texts(parse('not a.b == 1 and not c.d in [x]'))).toEqual(['a.b', 'c.d']);
  });

  it('比較の右辺リテラル(enum 値)はパスに含めない', () => {
    expect(texts(parse('entry.state == submitted'))).toEqual(['entry.state']);
  });
});

describe('createGuardServices', () => {
  it('GuardServices の 4 つの操作をすべて備える', () => {
    expect(typeof services.parse).toBe('function');
    expect(typeof services.collectPaths).toBe('function');
    expect(typeof services.satisfiability).toBe('function');
    expect(typeof services.canCoexist).toBe('function');
  });

  it('parse は失敗を例外ではなく Result で返す', () => {
    const result = services.parse('a ==');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.offset).toBe(4);
  });

  it('satisfiability / canCoexist が実装に配線されている', () => {
    const domains: DomainEnv = new Map([['s', { kind: 'finite', values: ['a', 'b'] }]]);
    expect(services.satisfiability(parse('s == a and s == b'), domains).verdict).toBe(
      'unsatisfiable',
    );
    expect(services.satisfiability(parse('s == a'), domains)).toEqual({
      verdict: 'satisfiable',
      witness: { s: 'a' },
    });
    expect(services.canCoexist(parse('s == a'), parse('s == b'), domains).coexists).toBe(false);
    expect(services.canCoexist(undefined, undefined, EMPTY).coexists).toBe(true);
  });
});
