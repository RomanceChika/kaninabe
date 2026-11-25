/**
 * ガード評価器のテスト。
 *
 * 網羅の基準は「ガード式の文法（domain-spec-writing.md）に書ける各構文 × 評価が
 * 成立・不成立・評価不能になる各ケース」。行カバレッジではない。
 */

import { describe, expect, it } from 'vitest';
import { containsKey, evaluateGuard, unresolvedPaths } from '../guard';
import type { GuardEnv, GuardExprData } from '@kaninabe/runtime/engine/types';

/** `path == literal` の式を組み立てる。 */
function eq(path: string, value: string | number): GuardExprData {
  return { kind: 'compare', path, op: '==', rhs: { kind: 'literal', value } };
}

describe('evaluateGuard — 比較', () => {
  const env: GuardEnv = { 'item.state': 'accepting' };

  // @spec framework-guarantee-catalog @tc TC-FW-GUARD-001
  it('等値比較が成立すれば true を返す', () => {
    expect(evaluateGuard(eq('item.state', 'accepting'), env)).toBe(true);
  });

  it('等値比較が成立しなければ false を返す', () => {
    expect(evaluateGuard(eq('item.state', 'closed'), env)).toBe(false);
  });

  it('非等値比較は等値の否定になる', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'item.state',
      op: '!=',
      rhs: { kind: 'literal', value: 'program_published' },
    };
    expect(evaluateGuard(expr, env)).toBe(true);
  });

  it('右辺がパスの比較は env の両方の値を突き合わせる', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'entry.patron_id',
      op: '==',
      rhs: { kind: 'path', path: 'actor.id' },
    };
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u1', 'actor.id': 'u1' })).toBe(true);
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u1', 'actor.id': 'u2' })).toBe(false);
  });

  it('数値の順序比較は境界値で >= と > を区別する', () => {
    const gte: GuardExprData = {
      kind: 'compare',
      path: 'entry.duration_min',
      op: '>=',
      rhs: { kind: 'literal', value: 10 },
    };
    const gt: GuardExprData = {
      kind: 'compare',
      path: 'entry.duration_min',
      op: '>',
      rhs: { kind: 'literal', value: 10 },
    };
    expect(evaluateGuard(gte, { 'entry.duration_min': 10 })).toBe(true);
    expect(evaluateGuard(gt, { 'entry.duration_min': 10 })).toBe(false);
  });

  it('数値の順序比較は境界値で <= と < を区別する', () => {
    const lte: GuardExprData = {
      kind: 'compare',
      path: 'entry.duration_min',
      op: '<=',
      rhs: { kind: 'literal', value: 10 },
    };
    const lt: GuardExprData = {
      kind: 'compare',
      path: 'entry.duration_min',
      op: '<',
      rhs: { kind: 'literal', value: 10 },
    };
    expect(evaluateGuard(lte, { 'entry.duration_min': 10 })).toBe(true);
    expect(evaluateGuard(lt, { 'entry.duration_min': 10 })).toBe(false);
  });

  it('ISO 8601 の日時文字列は字句順で時刻順に比較される', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'now',
      op: '>=',
      rhs: { kind: 'path', path: 'item.open_at' },
    };
    const open = '2026-08-01T10:00:00.000Z';
    expect(evaluateGuard(expr, { now: '2026-08-01T09:59:59.999Z', 'item.open_at': open })).toBe(false);
    expect(evaluateGuard(expr, { now: open, 'item.open_at': open })).toBe(true);
    expect(evaluateGuard(expr, { now: '2026-12-31T00:00:00.000Z', 'item.open_at': open })).toBe(true);
  });

  it('書式の違う ISO 8601 どうしは正規形に畳んでから比べる（DBだけが通す割れを塞ぐ）', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'item.open_at',
      op: '==',
      // 仕様には小数部なしで書き、envには `.000Z` 付きで届く（束 ⑳-1b で実測した反例）。
      rhs: { kind: 'literal', value: '2026-08-01T10:00:00Z' },
    };
    expect(evaluateGuard(expr, { 'item.open_at': '2026-08-01T10:00:00.000Z' })).toBe(true);
    // UTCオフセット表記の違いも同じ時刻として扱う。
    const offset: GuardExprData = {
      kind: 'compare',
      path: 'item.open_at',
      op: '==',
      rhs: { kind: 'literal', value: '2026-08-01T19:00:00+09:00' },
    };
    expect(evaluateGuard(offset, { 'item.open_at': '2026-08-01T10:00:00.000Z' })).toBe(true);
  });

  it('ISO 8601 の形をしていても実在しない日時は畳まず、字面のまま比べる', () => {
    // 正規形に畳めない（`new Date` が Invalid Date を返す）ので、素の字句順に落ちる。
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'item.open_at',
      op: '==',
      rhs: { kind: 'literal', value: '2026-13-45T00:00:00Z' },
    };
    expect(evaluateGuard(expr, { 'item.open_at': '2026-13-45T00:00:00Z' })).toBe(true);
    expect(evaluateGuard(expr, { 'item.open_at': '2026-13-45T00:00:00.000Z' })).toBe(false);
  });

  it('boolean の値は裸トークンの true / false と比較できる', () => {
    expect(evaluateGuard(eq('entry.is_draft', 'true'), { 'entry.is_draft': true })).toBe(true);
    expect(evaluateGuard(eq('entry.is_draft', 'false'), { 'entry.is_draft': true })).toBe(false);
  });

  it('boolean の値は裸トークンの true / false と非等値比較できる', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'entry.is_draft',
      op: '!=',
      rhs: { kind: 'literal', value: 'false' },
    };
    expect(evaluateGuard(expr, { 'entry.is_draft': true })).toBe(true);
    expect(evaluateGuard(expr, { 'entry.is_draft': false })).toBe(false);
  });

  it('boolean と true / false 以外の値の比較は評価不能とする', () => {
    // 仕様側が boolean のフィールドを状態名などと比べている = 仕様とenvの食い違い。偽に潰さない。
    expect(evaluateGuard(eq('entry.is_draft', 'accepting'), { 'entry.is_draft': true })).toBe('unknown');
  });

  it('boolean への順序比較は評価不能とする', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'entry.is_draft',
      op: '<',
      rhs: { kind: 'literal', value: 'true' },
    };
    expect(evaluateGuard(expr, { 'entry.is_draft': true })).toBe('unknown');
  });
});

describe('evaluateGuard — 評価不能', () => {
  it('env にパスが無ければ評価不能とする', () => {
    expect(evaluateGuard(eq('item.state', 'accepting'), {})).toBe('unknown');
  });

  it('値が null（値なし）なら評価不能とする', () => {
    expect(evaluateGuard(eq('item.state', 'accepting'), { 'item.state': null })).toBe('unknown');
  });

  it('型が揃わない比較は偽ではなく評価不能とする', () => {
    expect(evaluateGuard(eq('entry.duration_min', 'accepting'), { 'entry.duration_min': 10 })).toBe(
      'unknown',
    );
  });

  it('右辺パスが env に無ければ評価不能とする', () => {
    const expr: GuardExprData = {
      kind: 'compare',
      path: 'entry.patron_id',
      op: '==',
      rhs: { kind: 'path', path: 'actor.id' },
    };
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u1' })).toBe('unknown');
  });
});

describe('evaluateGuard — in', () => {
  const expr: GuardExprData = {
    kind: 'in',
    path: 'item.state',
    values: ['accepting', 'closed'],
  };

  it('候補に含まれれば true を返す', () => {
    expect(evaluateGuard(expr, { 'item.state': 'closed' })).toBe(true);
  });

  it('候補に含まれなければ false を返す', () => {
    expect(evaluateGuard(expr, { 'item.state': 'draft' })).toBe(false);
  });

  it('not in は in の否定になる', () => {
    const negated: GuardExprData = { kind: 'not', operand: expr };
    expect(evaluateGuard(negated, { 'item.state': 'draft' })).toBe(true);
    expect(evaluateGuard(negated, { 'item.state': 'closed' })).toBe(false);
  });

  it('候補のどれとも型が揃わなければ評価不能とする', () => {
    expect(evaluateGuard(expr, { 'item.state': 3 })).toBe('unknown');
  });

  it('env にパスが無ければ評価不能とする', () => {
    expect(evaluateGuard(expr, {})).toBe('unknown');
  });
});

describe('evaluateGuard — contains', () => {
  const expr: GuardExprData = {
    kind: 'contains',
    path: 'item.librarian_ids',
    ref: 'actor.id',
  };
  const key = containsKey('item.librarian_ids', 'actor.id');

  it('operation が解決した真偽値をそのまま返す', () => {
    expect(evaluateGuard(expr, { [key]: true })).toBe(true);
    expect(evaluateGuard(expr, { [key]: false })).toBe(false);
  });

  it('解決結果が env に無ければ評価不能とする（集合はエンジンでは持てない）', () => {
    expect(evaluateGuard(expr, { 'item.librarian_ids': 'u1' })).toBe('unknown');
  });
});

describe('evaluateGuard — and / or / not の合成', () => {
  const accepting = eq('item.state', 'accepting');
  const mine = eq('entry.patron_id', 'u1');
  const unknownPath = eq('item.state', 'accepting');

  it('and は両辺が真のときだけ真になる', () => {
    const expr: GuardExprData = { kind: 'and', left: accepting, right: mine };
    const base = { 'item.state': 'accepting', 'entry.patron_id': 'u1' };
    expect(evaluateGuard(expr, base)).toBe(true);
    expect(evaluateGuard(expr, { ...base, 'entry.patron_id': 'u2' })).toBe(false);
  });

  it('or は片辺が真なら真になる', () => {
    const expr: GuardExprData = { kind: 'or', left: accepting, right: mine };
    expect(evaluateGuard(expr, { 'item.state': 'closed', 'entry.patron_id': 'u1' })).toBe(true);
    expect(evaluateGuard(expr, { 'item.state': 'closed', 'entry.patron_id': 'u2' })).toBe(false);
  });

  it('not は真偽を反転する', () => {
    expect(evaluateGuard({ kind: 'not', operand: accepting }, { 'item.state': 'accepting' })).toBe(
      false,
    );
  });

  it('and は片辺が偽なら他辺が評価不能でも偽に確定する', () => {
    const expr: GuardExprData = { kind: 'and', left: mine, right: unknownPath };
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u2' })).toBe(false);
  });

  it('or は片辺が真なら他辺が評価不能でも真に確定する', () => {
    const expr: GuardExprData = { kind: 'or', left: mine, right: unknownPath };
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u1' })).toBe(true);
  });

  it('確定できない合成は評価不能を伝播する', () => {
    const conjunction: GuardExprData = { kind: 'and', left: mine, right: unknownPath };
    expect(evaluateGuard(conjunction, { 'entry.patron_id': 'u1' })).toBe('unknown');
    expect(evaluateGuard({ kind: 'not', operand: unknownPath }, {})).toBe('unknown');
  });

  it('or は片辺が偽でも他辺が評価不能なら評価不能になる', () => {
    // 偽で確定できるのは and だけ。or は残る辺次第で真になりうるので潰さない。
    const expr: GuardExprData = { kind: 'or', left: mine, right: unknownPath };
    expect(evaluateGuard(expr, { 'entry.patron_id': 'u2' })).toBe('unknown');
  });
});

describe('unresolvedPaths', () => {
  it('式が参照するパスのうち env から取り出せないものを列挙する', () => {
    const expr: GuardExprData = {
      kind: 'and',
      left: eq('item.state', 'accepting'),
      right: {
        kind: 'compare',
        path: 'entry.patron_id',
        op: '==',
        rhs: { kind: 'path', path: 'actor.id' },
      },
    };
    expect(unresolvedPaths(expr, { 'item.state': 'accepting', 'entry.patron_id': null })).toEqual([
      'entry.patron_id',
      'actor.id',
    ]);
  });

  it('not の内側が参照するパスも列挙する', () => {
    const expr: GuardExprData = { kind: 'not', operand: eq('item.state', 'accepting') };
    expect(unresolvedPaths(expr, {})).toEqual(['item.state']);
  });

  it('in が参照するパスも列挙する', () => {
    const expr: GuardExprData = { kind: 'in', path: 'item.state', values: ['accepting', 'closed'] };
    expect(unresolvedPaths(expr, {})).toEqual(['item.state']);
  });

  it('contains は解決済みキーの名前で報告する', () => {
    const expr: GuardExprData = { kind: 'contains', path: 'item.librarian_ids', ref: 'actor.id' };
    expect(unresolvedPaths(expr, {})).toEqual(['item.librarian_ids contains actor.id']);
  });

  it('型不一致で評価不能になった式では未解決パスは空になる', () => {
    expect(unresolvedPaths(eq('entry.duration_min', 'accepting'), { 'entry.duration_min': 10 })).toEqual(
      [],
    );
  });
});
