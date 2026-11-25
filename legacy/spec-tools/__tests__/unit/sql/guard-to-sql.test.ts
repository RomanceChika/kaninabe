/**
 * ガード式 → SQL 述語の翻訳(lib/sql/guard-to-sql.ts)。
 *
 * 意味の正は TS の評価器であり、その一致は実 DB の差分テスト
 * (`legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts`)が見る。
 * ここで固定するのは**字面**である —— 文法の構成要素ごとに 1 つずつ、どの SQL に落ちるか。
 */

import { describe, expect, it } from 'vitest';
import { parseGuard } from '../../../lib/guard/parser.js';
import { guardToSql, sqlLiteral, totalPredicate } from '../../../lib/sql/guard-to-sql.js';
import type { GuardSqlBindings } from '../../../lib/sql/guard-to-sql.js';
import type { ValueKind } from '../../../lib/model/field-values.js';
import type { PathRef } from '../../../lib/guard/ast.js';

/** この題材の欄の種別(呼び側が宣言する。翻訳器は列の型を自分では知らない)。 */
const KINDS: Readonly<Record<string, ValueKind>> = {
  'entry.state': 'text',
  'entry.count': 'number',
  'entry.locked': 'boolean',
  'entry.owner_id': 'opaque',
  'actor.id': 'opaque',
  'workshop.open_at': 'datetime',
  'entry.opened_at': 'datetime',
  'workshop.organizer_ids': 'text',
  'unknown.field': 'number',
};

/** 素直な列写像(`{entity}.{field}` → `{entity}.{field}`)。 */
const bindings: GuardSqlBindings = {
  column: (path: PathRef): string | null => (path.segments.length === 2 ? path.segments.join('.') : null),
  valueKind: (path: PathRef): ValueKind | null => KINDS[path.segments.join('.')] ?? null,
  contains: (path: PathRef, ref: PathRef): string => `${path.segments.join('_')}_has_${ref.segments.join('_')}`,
};

/** 式 1 本を訳す(パースは通る前提。通らなければテストが落ちる)。 */
function translate(source: string, resolve = bindings): string {
  const parsed = parseGuard(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const result = guardToSql(parsed.expr, resolve);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error([...result.unresolved, ...result.rejected].join(', '));
  return result.sql;
}

/** 式 1 本を訳して失敗を取り出す(断られる前提)。 */
function refuse(source: string, resolve = bindings): { unresolved: readonly string[]; rejected: readonly string[] } {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const result = guardToSql(parsed.expr, resolve);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`写せてしまいました: ${result.sql}`);
  return { unresolved: result.unresolved, rejected: result.rejected };
}

describe('guardToSql — 文法の構成要素', () => {
  it('等値比較はリテラルを文字列にして = に写す', () => {
    expect(translate('entry.state == draft')).toBe("coalesce(((entry.state) = 'draft'), false)");
  });

  it('不等号は <> に写す', () => {
    expect(translate('entry.state != draft')).toBe("coalesce(((entry.state) <> 'draft'), false)");
  });

  it('順序比較 4 種はそのままの記号で写る', () => {
    expect(translate('entry.count < 3')).toBe('coalesce(((entry.count) < 3), false)');
    expect(translate('entry.count <= 3')).toBe('coalesce(((entry.count) <= 3), false)');
    expect(translate('entry.count > 3')).toBe('coalesce(((entry.count) > 3), false)');
    expect(translate('entry.count >= 3')).toBe('coalesce(((entry.count) >= 3), false)');
  });

  it('右辺のパスは列参照になる', () => {
    expect(translate('entry.owner_id == actor.id')).toBe('coalesce(((entry.owner_id) = (actor.id)), false)');
  });

  it('予約語 now は now() になる', () => {
    expect(translate('now >= workshop.open_at')).toBe('coalesce((now() >= (workshop.open_at)), false)');
  });

  it('bindings.now を与えると now はその式になる(RPC はロック後の v_now を当てる)', () => {
    expect(translate('now >= entry.opened_at', { ...bindings, now: 'v_now' })).toBe(
      'coalesce((v_now >= (entry.opened_at)), false)',
    );
  });

  it('in はリテラルの並びに写る', () => {
    expect(translate('entry.state in [draft, submitted]')).toBe(
      "coalesce(((entry.state) in ('draft', 'submitted')), false)",
    );
  });

  it('not in は in の否定として写る(パーサーの正規化どおり)', () => {
    expect(translate('entry.state not in [draft]')).toBe("coalesce((not ((entry.state) in ('draft'))), false)");
  });

  it('contains は呼び側が与える式に写る', () => {
    expect(translate('workshop.organizer_ids contains actor.id')).toBe(
      'coalesce((workshop_organizer_ids_has_actor_id), false)',
    );
  });

  it('and / or は左結合で入れ子になる(not > and > or)', () => {
    expect(translate('entry.state == draft and not entry.locked == true or entry.count > 0')).toBe(
      "coalesce(((((entry.state) = 'draft') and (not ((entry.locked) = 'true'))) or ((entry.count) > 0)), false)",
    );
  });

  it('呼び側が与える列の字面は括弧で包む(primary でない式が返っても結合が壊れない)', () => {
    const wrapped = translate('entry.state == draft', {
      ...bindings,
      column: () => 'a.state or b.state',
    });
    expect(wrapped).toBe("coalesce(((a.state or b.state) = 'draft'), false)");
  });
});

describe('照合順序(text の順序比較)', () => {
  it('text の欄の順序比較には collate "C" が必ず付く(TS の文字列比較に合わせる)', () => {
    expect(translate('entry.state < published')).toBe(
      'coalesce(((entry.state collate "C") < \'published\'), false)',
    );
  });

  it('等値比較と in には付かない(照合順序に依らないため)', () => {
    expect(translate('entry.state == draft')).not.toContain('collate');
    expect(translate('entry.state in [draft]')).not.toContain('collate');
  });

  it('number / datetime の順序比較には付かない', () => {
    expect(translate('entry.count > 3')).not.toContain('collate');
    expect(translate('now >= workshop.open_at')).not.toContain('collate');
  });
});

describe('guardToSql — 写せないとき', () => {
  it('写せないパスは throw せず名前で返る', () => {
    expect(refuse('unknown.field == 1 and entry.state == draft', { ...bindings, column: () => null })).toEqual({
      unresolved: ['unknown.field', 'entry.state'],
      rejected: [],
    });
  });

  it('種別を宣言しない欄は写さない(照合順序を誰も見ないまま実行しない)', () => {
    expect(refuse('entry.state == draft', { ...bindings, valueKind: () => null })).toEqual({
      unresolved: ['entry.state'],
      rejected: [],
    });
  });

  it('contains の解決を宣言しなければ写せない', () => {
    expect(
      refuse('workshop.organizer_ids contains actor.id', {
        column: (path) => path.segments.join('.'),
        valueKind: (path) => KINDS[path.segments.join('.')] ?? null,
      }),
    ).toEqual({ unresolved: ['workshop.organizer_ids contains actor.id'], rejected: [] });
  });
});

describe('書けるが常に不成立の式は翻訳しない(V2 と同じ組を断る)', () => {
  it('boolean の欄への順序比較は断る', () => {
    const refused = refuse('entry.locked > false');
    expect(refused.unresolved).toEqual([]);
    expect(refused.rejected).toHaveLength(1);
    expect(refused.rejected[0]).toContain('entry.locked >');
  });

  it('boolean の欄への in は断る', () => {
    const refused = refuse('entry.locked in [true]');
    expect(refused.rejected).toHaveLength(1);
    expect(refused.rejected[0]).toContain('entry.locked in');
  });

  it('uuid / ref の欄への順序比較は断る(SQL に照合順序が無い)', () => {
    const refused = refuse('entry.owner_id < actor.id');
    // 左辺・右辺の両方が opaque なので、断った理由は 2 件とも並ぶ。
    expect(refused.rejected).toHaveLength(2);
  });

  it('boolean の欄の等値比較は通る(断るのは順序と in だけ)', () => {
    expect(translate('entry.locked == true')).toBe("coalesce(((entry.locked) = 'true'), false)");
  });
});

describe('NULL の規約', () => {
  it('閉じるのは式全体 1 回だけである(原子ごとではない)', () => {
    // 原子ごとに閉じると `not` の下で意味が変わる(DB だけが通す)。差分テストが実測した反例。
    const sql = translate('not entry.state == draft');
    expect(sql).toBe("coalesce((not ((entry.state) = 'draft')), false)");
    expect(sql.match(/coalesce/g)).toHaveLength(1);
  });

  it('totalPredicate は 3 値を 2 値に閉じる', () => {
    expect(totalPredicate('x = 1')).toBe('coalesce(x = 1, false)');
  });
});

describe('sqlLiteral', () => {
  it('単引用符をエスケープする', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });
});
