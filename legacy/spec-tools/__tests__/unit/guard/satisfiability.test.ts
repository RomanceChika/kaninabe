/**
 * 充足性判定の規約網羅テスト。
 * 対象規約: domain-spec-writing.md V8(決定性)/ V9(ガード充足性)と、
 * 変数ドメイン(finite 全列挙 / ordered 区間整合 / opaque 等号整合)の扱い。
 */

import { describe, expect, it } from 'vitest';
import type { DomainEnv, GuardExpr, SatResult, VariableDomain } from '../../../lib/guard/ast.js';
import { parseGuard } from '../../../lib/guard/parser.js';
import { canCoexist, satisfiability } from '../../../lib/guard/satisfiability.js';

/** テスト用: 式をパースして AST を得る。 */
function parse(source: string): GuardExpr {
  const result = parseGuard(source);
  if (!result.ok) throw new Error(`パースに失敗: ${result.error.message} @${result.error.offset}`);
  return result.expr;
}

/** テスト用: ドメイン宣言を組み立てる。 */
function env(entries: Record<string, VariableDomain>): DomainEnv {
  return new Map(Object.entries(entries));
}

const finite = (...values: string[]): VariableDomain => ({ kind: 'finite', values });
const ordered: VariableDomain = { kind: 'ordered' };
const integer: VariableDomain = { kind: 'ordered', discrete: true };
const opaque: VariableDomain = { kind: 'opaque' };
const EMPTY: DomainEnv = new Map();

/** テスト用: 生文字列を判定して verdict だけ取り出す。 */
function decide(source: string, domains: DomainEnv): string {
  return satisfiability(parse(source), domains).verdict;
}

/** テスト用: 生文字列を判定して結果全体を返す。 */
function decideFull(source: string, domains: DomainEnv): SatResult {
  return satisfiability(parse(source), domains);
}

describe('finite ドメイン(全列挙)', () => {
  const states = env({ 'workshop.state': finite('accepting', 'closed', 'program_published') });

  it('恒偽: 同じ変数に 2 つの等号', () => {
    expect(decide('workshop.state == accepting and workshop.state == closed', states)).toBe(
      'unsatisfiable',
    );
  });

  it('恒真: 排中律', () => {
    expect(decide('workshop.state == accepting or workshop.state != accepting', states)).toBe(
      'tautology',
    );
  });

  it('恒真: in が全値を覆う', () => {
    expect(decide('workshop.state in [accepting, closed, program_published]', states)).toBe(
      'tautology',
    );
  });

  it('充足可能: 単一の等号', () => {
    expect(decide('workshop.state == accepting', states)).toBe('satisfiable');
  });

  it('恒偽: in と等号が排他', () => {
    expect(decide('workshop.state == accepting and workshop.state in [closed]', states)).toBe(
      'unsatisfiable',
    );
  });

  it('恒偽: ドメインに無い値との等号', () => {
    expect(decide('workshop.state == cancelled', states)).toBe('unsatisfiable');
  });

  it('boolean も finite として扱える', () => {
    const flags = env({ 'entry.paid': finite('true', 'false') });
    expect(decide('entry.paid == true and entry.paid == false', flags)).toBe('unsatisfiable');
    expect(decide('entry.paid == true or entry.paid == false', flags)).toBe('tautology');
  });

  it('複数の finite 変数の直積を回す', () => {
    const two = env({ a: finite('x', 'y'), b: finite('p', 'q') });
    expect(decide('a == x and b == p', two)).toBe('satisfiable');
    expect(decide('a == x and a == y and b == p', two)).toBe('unsatisfiable');
  });

  it('両辺が finite 変数の比較も列挙で扱える', () => {
    const pair = env({ 'a.state': finite('draft', 'done'), 'b.state': finite('draft', 'done') });
    expect(decide('a.state == b.state', pair)).toBe('satisfiable');
    expect(decide('a.state == b.state or a.state != b.state', pair)).toBe('tautology');
    expect(decide('a.state == b.state and a.state != b.state', pair)).toBe('unsatisfiable');
  });
});

describe('ordered ドメイン(区間整合)', () => {
  const nums = env({ n: ordered });

  it('区間が交わらないと恒偽', () => {
    expect(decide('n < 5 and n > 10', nums)).toBe('unsatisfiable');
  });

  it('区間が交われば充足可能', () => {
    expect(decide('n > 5 and n < 10', nums)).toBe('satisfiable');
  });

  it('厳密不等号の同値は恒偽、非厳密なら充足可能', () => {
    expect(decide('n < 5 and n > 5', nums)).toBe('unsatisfiable');
    expect(decide('n <= 5 and n >= 5', nums)).toBe('satisfiable');
  });

  it('数直線を覆う選言は恒真', () => {
    expect(decide('n < 5 or n >= 5', nums)).toBe('tautology');
  });

  it('等号と区間の矛盾を見る', () => {
    expect(decide('n == 3 and n > 10', nums)).toBe('unsatisfiable');
    expect(decide('n == 3 and n != 3', nums)).toBe('unsatisfiable');
  });

  it('3 つ以上のリテラルでも推移律で矛盾を見つける', () => {
    expect(decide('n > 10 and n < 8 and n > 3', nums)).toBe('unsatisfiable');
  });

  it('連続ドメインでは隣接整数の間も充足可能', () => {
    expect(decide('n > 1 and n < 2', nums)).toBe('satisfiable');
  });
});

describe('discrete な ordered ドメイン(整数)', () => {
  const ints = env({ n: integer });

  it('隣接整数の間の開区間は恒偽', () => {
    expect(decide('n > 1 and n < 2', ints)).toBe('unsatisfiable');
  });

  it('整数が 1 つでも入れば充足可能', () => {
    expect(decide('n > 1 and n < 3', ints)).toBe('satisfiable');
    expect(decide('n >= 1 and n <= 1', ints)).toBe('satisfiable');
  });

  it('小数境界も整数側へ丸めて判定する', () => {
    expect(decide('n > 1.2 and n < 1.8', ints)).toBe('unsatisfiable');
    expect(decide('n > 1.2 and n < 2.8', ints)).toBe('satisfiable');
  });

  it('唯一の整数を除外すると恒偽', () => {
    expect(decide('n > 1 and n < 3 and n != 2', ints)).toBe('unsatisfiable');
  });

  it('discrete 宣言が無ければ従来どおり稠密に扱う', () => {
    expect(decide('n > 1 and n < 2', env({ n: ordered }))).toBe('satisfiable');
  });
});

describe('now・パス右辺(順序付き不透明値)', () => {
  const times = env({ now: ordered, 'workshop.open_at': ordered, 'workshop.close_at': ordered });

  it('now は env に無くても ordered として扱う', () => {
    expect(decide('now < 5 and now > 10', EMPTY)).toBe('unsatisfiable');
  });

  it('now と時刻フィールドの時間窓は充足可能', () => {
    expect(decide('now >= workshop.open_at and now < workshop.close_at', times)).toBe('satisfiable');
  });

  it('now と同じ時刻フィールドを両側から挟むと恒偽', () => {
    expect(decide('now >= workshop.open_at and now < workshop.open_at', times)).toBe('unsatisfiable');
  });

  it('パス右辺どうしの推移的な矛盾を見つける', () => {
    const source =
      'now > workshop.open_at and workshop.open_at > workshop.close_at and now < workshop.close_at';
    expect(decide(source, times)).toBe('unsatisfiable');
  });

  it('宣言の無いパス右辺は順序比較の文脈では ordered として扱う', () => {
    expect(decide('now >= workshop.open_at and now < workshop.open_at', EMPTY)).toBe('unsatisfiable');
  });

  it('日時リテラルとの比較でも区間整合を見る', () => {
    expect(decide('workshop.open_at > 2026-01-01 and workshop.open_at < 2026-01-01', times)).toBe(
      'unsatisfiable',
    );
  });
});

describe('opaque ドメイン(等号整合)', () => {
  it('相異なるリテラルとの等号は恒偽', () => {
    expect(decide('entry.performer_id == u1 and entry.performer_id == u2', EMPTY)).toBe(
      'unsatisfiable',
    );
  });

  it('同じリテラルとの等号・非等号は恒偽', () => {
    expect(decide('entry.performer_id == u1 and entry.performer_id != u1', EMPTY)).toBe(
      'unsatisfiable',
    );
  });

  it('別変数が同じ値を指すのは充足可能', () => {
    expect(decide('a.id == u1 and b.id == u1', EMPTY)).toBe('satisfiable');
  });

  it('パス右辺(actor.id)との等号も扱える', () => {
    expect(decide('entry.performer_id == actor.id', EMPTY)).toBe('satisfiable');
    expect(decide('entry.performer_id == actor.id and entry.performer_id != actor.id', EMPTY)).toBe(
      'unsatisfiable',
    );
    expect(decide('entry.performer_id == actor.id or entry.performer_id != actor.id', EMPTY)).toBe(
      'tautology',
    );
  });

  it('排中律は恒真', () => {
    expect(decide('a.id == u1 or a.id != u1', EMPTY)).toBe('tautology');
  });

  it('contains は自由な真偽値だが同じ原子は一貫する', () => {
    expect(decide('c.ids contains actor.id', EMPTY)).toBe('satisfiable');
    expect(decide('c.ids contains actor.id and not c.ids contains actor.id', EMPTY)).toBe(
      'unsatisfiable',
    );
    expect(decide('c.ids contains actor.id or not c.ids contains actor.id', EMPTY)).toBe(
      'tautology',
    );
  });
});

describe('finite と ordered の混在', () => {
  const mixed = env({ 'workshop.state': finite('accepting', 'closed'), n: ordered });

  it('finite が成立しても ordered が矛盾なら恒偽', () => {
    expect(decide('workshop.state == accepting and n < 5 and n > 10', mixed)).toBe('unsatisfiable');
  });

  it('finite の一部の割当でのみ ordered 部分が効く', () => {
    expect(decide('workshop.state == closed or n > 5 and n < 3', mixed)).toBe('satisfiable');
  });

  it('finite の全割当で ordered が矛盾するなら恒偽', () => {
    const oneBranchHolds =
      'workshop.state == accepting and n > 5 or workshop.state == closed and n < 5 and n > 9';
    expect(decide(oneBranchHolds, mixed)).toBe('satisfiable');
    expect(decide('workshop.state in [accepting, closed] and n < 5 and n > 9', mixed)).toBe(
      'unsatisfiable',
    );
  });
});

describe('witness(反例)', () => {
  it('finite 変数の割当を返す', () => {
    const states = env({ 'workshop.state': finite('accepting', 'closed') });
    expect(decideFull('workshop.state == accepting', states).witness).toEqual({
      'workshop.state': 'accepting',
    });
  });

  it('複数の finite 変数を同時に返す(V8 の反例形式)', () => {
    const domains = env({
      'entry.state': finite('submitted', 'accepted'),
      'workshop.state': finite('accepting', 'closed'),
    });
    expect(
      decideFull('entry.state == submitted and workshop.state == accepting', domains).witness,
    ).toEqual({ 'entry.state': 'submitted', 'workshop.state': 'accepting' });
  });

  it('ordered 変数は区間の代表値を返す', () => {
    const witness = decideFull('n > 5 and n < 10', env({ n: ordered })).witness;
    expect(Number(witness?.['n'])).toBeGreaterThan(5);
    expect(Number(witness?.['n'])).toBeLessThan(10);
  });

  it('整数ドメインでは整数の代表値を返す', () => {
    expect(decideFull('n > 1 and n < 4 and n != 2', env({ n: integer })).witness).toEqual({
      n: '3',
    });
  });

  it('opaque 変数は等号で固定されていれば返す', () => {
    expect(decideFull('entry.performer_id == u1', EMPTY).witness).toEqual({
      'entry.performer_id': 'u1',
    });
  });

  it('復元できる変数が無ければ witness を付けない(空オブジェクトは返さない)', () => {
    const times = env({ now: ordered, 'workshop.open_at': ordered });
    expect(decideFull('now >= workshop.open_at', times).witness).toBeUndefined();
  });

  it('恒偽には witness が無い', () => {
    expect(decideFull('n < 5 and n > 10', env({ n: ordered })).witness).toBeUndefined();
  });

  it('unknown には witness が無い', () => {
    expect(decideFull('id < u1', env({ id: opaque })).witness).toBeUndefined();
  });
});

describe('unknown(v1 の判定能力を超えるケース)', () => {
  it('finite ドメインに順序比較を書いた式', () => {
    expect(decide('workshop.state < accepting', env({ 'workshop.state': finite('a', 'b') }))).toBe(
      'unknown',
    );
  });

  it('opaque と宣言されたドメインに順序比較を書いた式', () => {
    expect(decide('entry.performer_id < u1', env({ 'entry.performer_id': opaque }))).toBe('unknown');
  });

  it('finite 変数と非 finite 変数を比較する式', () => {
    const domains = env({ 'a.state': finite('x', 'y'), 'b.count': ordered });
    expect(decide('a.state == b.count', domains)).toBe('unknown');
    expect(decide('a.state == b.id', env({ 'a.state': finite('x', 'y'), 'b.id': opaque }))).toBe(
      'unknown',
    );
  });

  it('finite 変数の直積が 10^6 を超える式', () => {
    const vars = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const domains = env(Object.fromEntries(vars.map((v) => [v, finite('t', 'f')])));
    const source = vars.map((v) => `${v} == t`).join(' and ');
    expect(decide(source, domains)).toBe('unknown');
  });

  it('直積が上限内なら列挙する', () => {
    const vars = Array.from({ length: 19 }, (_, i) => `v${i}`);
    const domains = env(Object.fromEntries(vars.map((v) => [v, finite('t', 'f')])));
    const source = vars.map((v) => `${v} == t`).join(' and ');
    expect(decide(source, domains)).toBe('satisfiable');
  });

  it('finite 以外の原子が多すぎる式', () => {
    const source = Array.from({ length: 13 }, (_, i) => `n${i} == u${i}`).join(' and ');
    expect(decide(source, EMPTY)).toBe('unknown');
  });
});

describe('canCoexist', () => {
  const states = env({ 'workshop.state': finite('accepting', 'closed') });

  it('両方 undefined(常に真)は共存する', () => {
    expect(canCoexist(undefined, undefined, states).coexists).toBe(true);
  });

  it('片方 undefined なら他方が充足可能かで決まる', () => {
    expect(canCoexist(undefined, parse('workshop.state == accepting'), states).coexists).toBe(true);
    expect(
      canCoexist(parse('workshop.state == accepting and workshop.state == closed'), undefined, states)
        .coexists,
    ).toBe(false);
  });

  it('重複して成立するガードは共存し、反例を返す', () => {
    const result = canCoexist(
      parse('workshop.state == accepting'),
      parse('workshop.state != closed'),
      states,
    );
    expect(result.coexists).toBe(true);
    expect(result.witness).toEqual({ 'workshop.state': 'accepting' });
  });

  it('排他なガードは共存しない', () => {
    const result = canCoexist(
      parse('workshop.state == accepting'),
      parse('workshop.state == closed'),
      states,
    );
    expect(result.coexists).toBe(false);
    expect(result.witness).toBeUndefined();
  });

  it('ordered 区間が交わらないガードは共存しない', () => {
    const nums = env({ n: ordered });
    expect(canCoexist(parse('n < 5'), parse('n > 10'), nums).coexists).toBe(false);
    expect(canCoexist(parse('n < 5 and n > 3'), parse('n > 10 and n < 12'), nums).coexists).toBe(
      false,
    );
    expect(canCoexist(parse('n < 5'), parse('n > 3'), nums).coexists).toBe(true);
  });

  it('判定不能なガードは共存し得るものとして扱う(過検出側に倒す)', () => {
    const result = canCoexist(parse('id < u1'), parse('n == 1'), env({ id: opaque }));
    expect(result.coexists).toBe(true);
    expect(result.witness).toBeUndefined();
  });
});
