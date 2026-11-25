/**
 * ガード式パーサーの規約網羅テスト。
 * 対象規約: domain-spec-writing.md §ガード式の文法(EBNF・優先順位・左結合)。
 */

import { describe, expect, it } from 'vitest';
import type { GuardExpr, GuardParseError } from '../../../lib/guard/ast.js';
import { parseGuard } from '../../../lib/guard/parser.js';

/** パースが成功する前提で AST を取り出す。 */
function ast(source: string): GuardExpr {
  const result = parseGuard(source);
  if (!result.ok) throw new Error(`パースに失敗: ${result.error.message} @${result.error.offset}`);
  return result.expr;
}

/** パースが失敗する前提でエラーを取り出す。 */
function failure(source: string): GuardParseError {
  const result = parseGuard(source);
  if (result.ok) throw new Error(`パースが成功してしまった: ${source}`);
  return result.error;
}

describe('atom の各形式', () => {
  it('path op literal(記号リテラル)を読む', () => {
    expect(ast('workshop.state == accepting')).toEqual({
      kind: 'compare',
      path: { segments: ['workshop', 'state'] },
      op: '==',
      rhs: { kind: 'symbol', value: 'accepting' },
    });
  });

  it('6 種の比較演算子をすべて読む', () => {
    for (const op of ['==', '!=', '<', '<=', '>', '>=']) {
      expect(ast(`n ${op} 1`)).toEqual({
        kind: 'compare',
        path: { segments: ['n'] },
        op,
        rhs: { kind: 'number', value: 1 },
      });
    }
  });

  it('数値リテラル(小数・負数)を number として読む', () => {
    expect(ast('entry.duration_min <= 30.5')).toMatchObject({
      rhs: { kind: 'number', value: 30.5 },
    });
    expect(ast('entry.offset > -2')).toMatchObject({ rhs: { kind: 'number', value: -2 } });
  });

  it('日時リテラルを symbol として読む', () => {
    expect(ast('workshop.open_at >= 2026-01-01T09:00:00Z')).toMatchObject({
      rhs: { kind: 'symbol', value: '2026-01-01T09:00:00Z' },
    });
    expect(ast('workshop.held_on >= 2026-01-01')).toMatchObject({
      rhs: { kind: 'symbol', value: '2026-01-01' },
    });
  });

  it('path op path: ドットを含む右辺はパスとして読む', () => {
    expect(ast('entry.performer_id == actor.id')).toEqual({
      kind: 'compare',
      path: { segments: ['entry', 'performer_id'] },
      op: '==',
      rhs: { kind: 'path', path: { segments: ['actor', 'id'] } },
    });
  });

  it('path op path: 予約語 now / actor はドット無しでもパス', () => {
    expect(ast('workshop.open_at <= now')).toMatchObject({
      rhs: { kind: 'path', path: { segments: ['now'] } },
    });
    expect(ast('entry.performer_id == actor')).toMatchObject({
      rhs: { kind: 'path', path: { segments: ['actor'] } },
    });
  });

  it('ドット無しの裸トークンはリテラル(enum 値と区別が付かないため)', () => {
    expect(ast('entry.state == submitted')).toMatchObject({
      rhs: { kind: 'symbol', value: 'submitted' },
    });
  });

  it('予約語 now を左辺のパスとして読む', () => {
    expect(ast('now >= workshop.open_at')).toEqual({
      kind: 'compare',
      path: { segments: ['now'] },
      op: '>=',
      rhs: { kind: 'path', path: { segments: ['workshop', 'open_at'] } },
    });
  });

  it('path in [literals] を読む', () => {
    expect(ast('state in [submitted, accepted]')).toEqual({
      kind: 'in',
      path: { segments: ['state'] },
      values: [
        { kind: 'symbol', value: 'submitted' },
        { kind: 'symbol', value: 'accepted' },
      ],
    });
  });

  it('path contains ref-literal を読む', () => {
    expect(ast('workshop.organizer_ids contains actor.id')).toEqual({
      kind: 'contains',
      path: { segments: ['workshop', 'organizer_ids'] },
      ref: { segments: ['actor', 'id'] },
    });
  });

  it('path not in [...] を not(in) に畳む(規約の invariant_spec 例に合わせる)', () => {
    expect(ast('state not in [withdrawn, rejected]')).toEqual({
      kind: 'not',
      operand: {
        kind: 'in',
        path: { segments: ['state'] },
        values: [
          { kind: 'symbol', value: 'withdrawn' },
          { kind: 'symbol', value: 'rejected' },
        ],
      },
    });
  });
});

describe('優先順位と結合', () => {
  it('not は and より強い', () => {
    expect(ast('not a == 1 and b == 2')).toMatchObject({
      kind: 'and',
      left: { kind: 'not', operand: { kind: 'compare', path: { segments: ['a'] } } },
      right: { kind: 'compare', path: { segments: ['b'] } },
    });
  });

  it('and は or より強い(a and b or c は (a and b) or c)', () => {
    expect(ast('a == 1 and b == 2 or c == 3')).toMatchObject({
      kind: 'or',
      left: { kind: 'and' },
      right: { kind: 'compare', path: { segments: ['c'] } },
    });
  });

  it('or の右側の and もまとまる(a or b and c は a or (b and c))', () => {
    expect(ast('a == 1 or b == 2 and c == 3')).toMatchObject({
      kind: 'or',
      left: { kind: 'compare', path: { segments: ['a'] } },
      right: { kind: 'and' },
    });
  });

  it('and は左結合', () => {
    expect(ast('a == 1 and b == 2 and c == 3')).toMatchObject({
      kind: 'and',
      left: { kind: 'and', left: { path: { segments: ['a'] } }, right: { path: { segments: ['b'] } } },
      right: { path: { segments: ['c'] } },
    });
  });

  it('or は左結合', () => {
    expect(ast('a == 1 or b == 2 or c == 3')).toMatchObject({
      kind: 'or',
      left: { kind: 'or', left: { path: { segments: ['a'] } }, right: { path: { segments: ['b'] } } },
      right: { path: { segments: ['c'] } },
    });
  });

  it('not は in 原子にも掛かる', () => {
    expect(ast('not state in [draft]')).toMatchObject({ kind: 'not', operand: { kind: 'in' } });
  });
});

describe('スペース・角括弧の揺れ', () => {
  it('空白なしでも読める', () => {
    expect(ast('state==accepting')).toEqual(ast('state == accepting'));
  });

  it('角括弧まわりの空白・改行の揺れを吸収する', () => {
    const tight = ast('state in[submitted,accepted]');
    expect(ast('state  in  [ submitted , accepted ]')).toEqual(tight);
    expect(ast('state\n in [\n  submitted,\n  accepted\n]')).toEqual(tight);
  });

  it('要素 1 つの in リストを読める', () => {
    expect(ast('state in [draft]')).toMatchObject({ kind: 'in', values: [{ value: 'draft' }] });
  });
});

describe('不正入力(位置付きエラー)', () => {
  it('空文字列は式の終わりを指すエラーになる', () => {
    expect(failure('')).toEqual({
      message: expect.stringContaining('名前'),
      offset: 0,
      length: 0,
    });
  });

  it('エラーは該当トークンの長さを持つ(下線表示用)', () => {
    const source = 'a == 1 extra == 2';
    expect(failure(source)).toMatchObject({ offset: source.indexOf('extra'), length: 5 });
    expect(failure('a == 1 & b == 2')).toMatchObject({ length: 1 });
  });

  it('比較の右辺が無い', () => {
    const source = 'state ==';
    expect(failure(source).offset).toBe(source.length);
  });

  it('比較演算子も in も contains も無い', () => {
    const source = 'workshop.state accepting';
    const error = failure(source);
    expect(error.offset).toBe(source.indexOf('accepting'));
    expect(error.message).toContain('workshop.state');
  });

  it('空の in リストを拒否する', () => {
    const source = 'state in []';
    expect(failure(source).offset).toBe(source.indexOf(']'));
  });

  it('末尾カンマを拒否する', () => {
    const source = 'state in [draft, ]';
    expect(failure(source).offset).toBe(source.indexOf(']'));
  });

  it('閉じ括弧が無い', () => {
    const source = 'state in [draft';
    expect(failure(source).offset).toBe(source.length);
  });

  it('予約語をパス名に使えない', () => {
    const source = 'and b == 1';
    expect(failure(source).offset).toBe(0);
  });

  it('予約語をリテラルに使えない', () => {
    const source = 'state == and';
    expect(failure(source).offset).toBe(source.indexOf('and'));
  });

  it('式の後の余分なトークンを拒否する', () => {
    const source = 'a == 1 b == 2';
    const error = failure(source);
    expect(error.offset).toBe(source.indexOf('b'));
    expect(error.message).toContain('余分');
  });

  it('not の連続を拒否する', () => {
    const source = 'not not a == 1';
    expect(failure(source).offset).toBe(source.indexOf('not', 1));
  });

  it('文法にない文字を位置付きで拒否する', () => {
    const source = 'a == 1 & b == 2';
    expect(failure(source).offset).toBe(source.indexOf('&'));
  });

  it('括弧は書けない(v1)', () => {
    const source = '(a == 1)';
    expect(failure(source).offset).toBe(0);
  });

  it('and の右辺が欠けている', () => {
    const source = 'a == 1 and';
    expect(failure(source).offset).toBe(source.length);
  });
});
