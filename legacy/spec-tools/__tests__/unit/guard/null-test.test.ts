/**
 * 「空かどうか」(`is null` / `is not null`)を買った分の単体テスト(束 ㉒)。
 *
 * 設計の正: docs/design/null-literal-purchase.md
 * 文法の正: docs/rules/process/common/specification/standards/domain-spec-writing.md §ガード式の文法
 *
 * ここで固定するのは 4 つである。
 *  1. **置き場**: 既定の口では断られ、`formal` を読む口でだけ受け取れる。
 *  2. **原子の同一性**: `is not null` は `is null` の否定として読まれる(別の原子にしない)。
 *  3. **意味**: 空の欄の比較はすべて偽。比較の意味そのものは 1 文字も変えない。
 *  4. **写像**: SQL は `is null`、SMT は相棒の `Bool`、日本語は「空である / 空でない」。
 */

import { describe, expect, it } from 'vitest';
import type { DomainEnv, GuardExpr, VariableDomain } from '../../../lib/guard/ast.js';
import { parseFormalGuard, parseGuard } from '../../../lib/guard/parser.js';
import { forEachAtom, type Atom } from '../../../lib/guard/atoms.js';
import { satisfiability } from '../../../lib/guard/satisfiability.js';
import { translateToSmt } from '../../../lib/guard/smt.js';
import { EMPTY_WITNESS } from '../../../lib/guard/witness.js';
import { guardToSql } from '../../../lib/sql/guard-to-sql.js';

/** テスト用の環境(`doc.venue_id` は空になりうる欄のつもり)。 */
const ENV: DomainEnv = new Map<string, VariableDomain>([
  ['doc.state', { kind: 'finite', values: ['draft', 'archived'] }],
  ['doc.venue_id', { kind: 'opaque' }],
  ['doc.opens_at', { kind: 'ordered' }],
]);

/** `formal` の口でパースする(テストの書き間違いは例外で落とす)。 */
function formal(source: string): GuardExpr {
  const result = parseFormalGuard(source);
  if (!result.ok) throw new Error(`パースに失敗: ${result.error.message}`);
  return result.expr;
}

/** 式に現れる原子のキーを出現順に集める。 */
function atomKeys(source: string): string[] {
  const keys: string[] = [];
  forEachAtom(formal(source), (atom: Atom) => keys.push(atom.key));
  return keys;
}

describe('置き場 — 開いているのは formal を読む口だけ', () => {
  it('既定の口(ガード・when・binding・filters)は is null を断る', () => {
    const result = parseGuard('doc.venue_id is null');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('不変条件の formal だけ');
  });

  it('既定の口は is not null も断る', () => {
    expect(parseGuard('doc.venue_id is not null').ok).toBe(false);
  });

  it('formal の口は受け取る', () => {
    expect(formal('doc.venue_id is null')).toEqual({
      kind: 'null',
      path: { segments: ['doc', 'venue_id'] },
    });
  });

  it('is not null は not に包んで返す(2 つの綴りを同じ原子の否定にする)', () => {
    expect(formal('doc.venue_id is not null')).toEqual({
      kind: 'not',
      operand: { kind: 'null', path: { segments: ['doc', 'venue_id'] } },
    });
  });

  it('is の後ろに null が無ければ断る', () => {
    const result = parseFormalGuard('doc.venue_id is blank');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('null');
  });

  it('is / null は欄名にもリテラルにも使えない(予約語)', () => {
    expect(parseGuard('doc.null == draft').ok).toBe(false);
    expect(parseGuard('doc.state == null').ok).toBe(false);
  });
});

describe('原子の同一性 — 2 つの綴りは同じ原子になる', () => {
  it('is null と is not null は同じ key を持つ', () => {
    expect(atomKeys('doc.venue_id is null')).toEqual(['doc.venue_id is null']);
    expect(atomKeys('doc.venue_id is not null')).toEqual(['doc.venue_id is null']);
  });

  it('矛盾(空かつ空でない)を不能と読める', () => {
    expect(satisfiability(formal('doc.venue_id is null and doc.venue_id is not null'), ENV).verdict).toBe(
      'unsatisfiable',
    );
  });

  it('排中(空か空でないか)を恒真と読める', () => {
    expect(satisfiability(formal('doc.venue_id is null or doc.venue_id is not null'), ENV).verdict).toBe(
      'tautology',
    );
  });
});

describe('意味 — 空の欄の比較は成立しない', () => {
  it('空である欄をリテラルと比べる条件は不能', () => {
    expect(satisfiability(formal('doc.venue_id is null and doc.venue_id == hall'), ENV).verdict).toBe(
      'unsatisfiable',
    );
  });

  it('空である欄の順序比較も不能', () => {
    expect(satisfiability(formal('doc.opens_at is null and doc.opens_at > 2026-01-01'), ENV).verdict).toBe(
      'unsatisfiable',
    );
  });

  it('比較の意味そのものは変えない(空を問わない式の判定は従来どおり)', () => {
    expect(satisfiability(formal('doc.state == draft and doc.state == archived'), ENV).verdict).toBe(
      'unsatisfiable',
    );
    expect(satisfiability(formal('doc.venue_id == hall'), ENV).verdict).toBe('satisfiable');
  });

  it('含意の形(状態と欄の有無の同値)は充足可能である', () => {
    const expr = formal('doc.state == archived or doc.venue_id is null');
    expect(satisfiability(expr, ENV).verdict).toBe('satisfiable');
  });

  it('反例は空の欄を「(空)」と書く(値を当てない)', () => {
    const result = satisfiability(formal('doc.venue_id is null'), ENV);
    expect(result.witness?.['doc.venue_id']).toBe(EMPTY_WITNESS);
  });
});

describe('写像 — SQL / SMT', () => {
  it('SQL は is null をそのまま訳す(全体の coalesce はそのまま)', () => {
    const result = guardToSql(formal('doc.venue_id is null'), {
      column: (path) => `docs.${path.segments[1] ?? ''}`,
      valueKind: () => 'opaque',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toBe('coalesce(((docs.venue_id) is null), false)');
  });

  it('SQL は is not null を not で包む', () => {
    const result = guardToSql(formal('doc.venue_id is not null'), {
      column: (path) => `docs.${path.segments[1] ?? ''}`,
      valueKind: () => 'opaque',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toContain('(not ((docs.venue_id) is null))');
  });

  it('SMT は欄ごとに相棒の Bool を宣言する', () => {
    const translation = translateToSmt(formal('doc.venue_id is null'), ENV);
    expect(translation.declarations).toContain('(declare-const |null!doc.venue_id| Bool)');
    expect(translation.formula).toBe('|null!doc.venue_id|');
    expect(translation.nullVars).toEqual([{ smtName: '|null!doc.venue_id|', path: 'doc.venue_id' }]);
  });

  it('SMT は同じ式に現れた欄の比較を「空でない」で包む', () => {
    const translation = translateToSmt(formal('doc.venue_id is null or doc.venue_id == hall'), ENV);
    expect(translation.formula).toContain('(and (not |null!doc.venue_id|)');
  });

  it('SMT は is null が現れない欄の写し方を変えない', () => {
    const translation = translateToSmt(formal('doc.venue_id is null and doc.state == draft'), ENV);
    expect(translation.formula).toContain('(= |doc.state| 0)');
    expect(translation.declarations).not.toContain('|null!doc.state|');
  });
});
