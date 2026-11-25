/**
 * 不変条件の `formal` → 行の CHECK の式(`lib/sql/check-expression.ts`)のユニットテスト。
 *
 * 規約網羅(design/check-generation.md §1-2):
 *   - 字面は **Postgres が `pg_get_constraintdef` で印字する形**である。ここに並ぶ期待値は
 *     実 DB(ローカルの Postgres に一時表で当てて読み直したもの)から取った実測であり、
 *     **推測ではない** —— 字面が 1 文字違えば `ddl-parity` が落ち、冪等の判定も外れる
 *   - 全域化は式全体を 1 回だけ `COALESCE(…, false)` で包む(`totalPredicate` と同じ規約)
 *   - `and` / `or` は大文字で、**同じ演算子の入れ子は平らに畳む**
 *   - リテラルの cast は欄の型で決まる(text → `::text` / boolean は裸 / integer は裸 /
 *     decimal の整数は `(0)::numeric`)
 *   - 反映できない式は**理由**を返す(別集約の欄 / `now` / `contains` / 日時のリテラル /
 *     `formal` が無い / `check` 以外の `formal.type`)
 */

import { describe, expect, it } from 'vitest';
import { checkExpressionOf } from '../../../lib/sql/check-expression.js';
import { aggregate, entitySpec, loc, machine, specModel } from '../../helpers/model-builder.js';
import type {
  FieldDef,
  FieldType,
  InvariantDef,
  InvariantFormal,
  SpecModel,
} from '../../../lib/model/types.js';

/** 欄を 1 つ作る。 */
function col(name: string, type: FieldType, opts: Partial<FieldDef> = {}): FieldDef {
  return {
    name,
    type,
    required: false,
    auto: false,
    personal: false,
    session: false,
    location: loc('docs/specs/domain/document/entity.md', `fields.${name}`),
    ...opts,
  };
}

/** 題材: 文書(document)。状態機械 1 つ(`draft` → `archived`)。 */
const FIELDS: readonly FieldDef[] = [
  col('state', { kind: 'state', machine: 'document' }, { required: true }),
  col('title', { kind: 'string' }),
  col('archived_at', { kind: 'datetime' }),
  col('archived_by', { kind: 'ref', entity: 'staff' }),
  col('copies', { kind: 'integer' }),
  col('fee', { kind: 'decimal' }),
  col('public', { kind: 'boolean' }, { required: true }),
];

/** 不変条件 1 本を持つモデル(相手の集約 `staff` も置く)。 */
function domain(formal: InvariantFormal | undefined): SpecModel {
  const invariant: InvariantDef = {
    id: 'INV-DOCUMENT-001',
    statement: '試験用',
    entities: ['document'],
    ...(formal === undefined ? {} : { formal }),
    enforcedBy: [],
    location: loc('docs/specs/domain/document/invariants.md'),
  };
  return specModel([
    aggregate('document', {
      entity: entitySpec('document', { fields: FIELDS }),
      stateMachines: [machine('document', { states: ['draft', 'archived'], initial: 'draft' })],
      invariants: { invariants: [invariant], location: loc('docs/specs/domain/document/invariants.md') },
    }),
    aggregate('staff', { entity: entitySpec('staff', { fields: [col('active', { kind: 'boolean' })] }) }),
  ]);
}

/** `type: check` の 1 本を写す。 */
function written(expr: string) {
  const model = domain({ kind: 'check', expr });
  const entity = model.aggregates.get('document')?.entity;
  if (entity === undefined) throw new Error('題材の entity_spec が引けません');
  return checkExpressionOf('INV-DOCUMENT-001', entity, model);
}

/** 写せた前提で式だけを取り出す。 */
function sql(expr: string): string {
  const result = written(expr);
  if (!result.ok) throw new Error(`写せませんでした: ${result.reason}`);
  return result.expression;
}

/** 写せなかった前提で理由だけを取り出す。 */
function reason(expr: string): string {
  const result = written(expr);
  if (result.ok) throw new Error(`写せてしまいました: ${result.expression}`);
  return result.reason;
}

describe('不変条件の formal から行の CHECK の式を作る', () => {
  it('式全体を 1 回だけ COALESCE(…, false) で包む', () => {
    expect(sql('document.copies >= 1')).toBe('COALESCE((copies >= 1), false)');
  });

  it('列は別名を付けずそのまま書く(CHECK は 1 行の中にいる)', () => {
    expect(sql('document.archived_at < document.archived_at')).toBe(
      'COALESCE((archived_at < archived_at), false)',
    );
  });

  it('text の欄のリテラルには ::text の cast が付く', () => {
    expect(sql('document.state == archived')).toBe("COALESCE((state = 'archived'::text), false)");
  });

  it('boolean は裸の true / false、integer は裸の数、decimal の整数は (0)::numeric', () => {
    expect(sql('document.public == true')).toBe('COALESCE((public = true), false)');
    expect(sql('document.copies != 3')).toBe('COALESCE((copies <> 3), false)');
    expect(sql('document.fee >= 0')).toBe('COALESCE((fee >= (0)::numeric), false)');
  });

  it('and / or は大文字で、同じ演算子の入れ子は平らに畳む', () => {
    expect(sql('document.public == true and document.copies >= 1 and document.copies <= 9')).toBe(
      'COALESCE(((public = true) AND (copies >= 1) AND (copies <= 9)), false)',
    );
  });

  it('and は or より強く結合し、印字も入れ子の括弧で表れる', () => {
    expect(sql('document.public == true and document.copies >= 1 or document.copies <= 9')).toBe(
      'COALESCE((((public = true) AND (copies >= 1)) OR (copies <= 9)), false)',
    );
  });

  it('in は = ANY (ARRAY[…])、not in はそれを NOT で包む', () => {
    expect(sql('document.state in [draft, archived]')).toBe(
      "COALESCE((state = ANY (ARRAY['draft'::text, 'archived'::text])), false)",
    );
    expect(sql('document.state not in [draft]')).toBe(
      "COALESCE((NOT (state = ANY (ARRAY['draft'::text]))), false)",
    );
  });

  it('空かどうかは IS NULL / IS NOT NULL に落ちる', () => {
    expect(sql('document.archived_at is null')).toBe('COALESCE((archived_at IS NULL), false)');
    expect(sql('document.archived_at is not null')).toBe('COALESCE((archived_at IS NOT NULL), false)');
  });

  it('text の順序比較には COLLATE "C" が付く(TS の評価器と同じ順序にするため)', () => {
    expect(sql('document.title < zz')).toBe(
      'COALESCE(((title COLLATE "C") < \'zz\'::text), false)',
    );
  });

  it('実測: archive の INV-DOCUMENT-002 と同じ形が、実 DB の印字と 1 文字も違わない', () => {
    expect(
      sql(
        'document.state == archived and document.archived_at is not null and document.archived_by is not null' +
          ' or document.state != archived and document.archived_at is null and document.archived_by is null',
      ),
    ).toBe(
      "COALESCE((((state = 'archived'::text) AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL))" +
        " OR ((state <> 'archived'::text) AND (archived_at IS NULL) AND (archived_by IS NULL))), false)",
    );
  });

  it('別の集約の欄を参照する式は反映せず、理由を報告する', () => {
    expect(reason('document.archived_by == staff.active')).toContain('別の集約 staff');
  });

  it('不変条件が住む集約の綴りは、写す先の集約の別名にならない', () => {
    // `staff` の集約に住む不変条件を `document` の表に写す場面。**住んでいる集約の綴りを
    // 別名に入れてしまうと `staff.title` が `documents.title` に化ける** —— 別の集約を指す
    // パスが自分の列に解決し、恒真の CHECK が静かに生まれる(`prove:checks` の実測で発覚)。
    const model = domain(undefined);
    const staff = model.aggregates.get('staff');
    const document = model.aggregates.get('document');
    if (staff === undefined || document?.entity === undefined) throw new Error('題材が組み立てられません');
    const aggregates = new Map(model.aggregates);
    aggregates.set('staff', {
      ...staff,
      invariants: {
        invariants: [
          {
            id: 'INV-STAFF-001',
            statement: '試験用',
            entities: ['staff', 'document'],
            formal: { kind: 'check', expr: 'staff.title == document.title' },
            enforcedBy: [],
            location: loc('docs/specs/domain/staff/invariants.md'),
          },
        ],
        location: loc('docs/specs/domain/staff/invariants.md'),
      },
    });
    const result = checkExpressionOf('INV-STAFF-001', document.entity, { ...model, aggregates });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('別の集約 staff');
  });

  it('now を参照する式は反映せず、理由を報告する(CHECK には不変な式しか書けない)', () => {
    expect(reason('document.archived_at < now')).toContain('now を参照しています');
  });

  it('日時のリテラルとの比較は反映せず、理由を報告する(DB が字面を書き換える)', () => {
    expect(reason('document.archived_at < 2026-01-01T00:00:00Z')).toContain('日時のリテラル');
  });

  it('formal が無ければ反映せず、理由を報告する', () => {
    const model = domain(undefined);
    const entity = model.aggregates.get('document')?.entity;
    if (entity === undefined) throw new Error('題材の entity_spec が引けません');
    const result = checkExpressionOf('INV-DOCUMENT-001', entity, model);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('formal がありません');
  });

  it('check 以外の formal.type は反映せず、執行点が別の形であることを報告する', () => {
    const model = domain({ kind: 'uniqueness', keys: ['title'] });
    const entity = model.aggregates.get('document')?.entity;
    if (entity === undefined) throw new Error('題材の entity_spec が引けません');
    const result = checkExpressionOf('INV-DOCUMENT-001', entity, model);
    expect(result.ok ? '' : result.reason).toContain('formal.type: uniqueness');
  });

  it('実在しない不変条件 ID は理由を報告する', () => {
    const model = domain({ kind: 'check', expr: 'document.copies >= 1' });
    const entity = model.aggregates.get('document')?.entity;
    if (entity === undefined) throw new Error('題材の entity_spec が引けません');
    const result = checkExpressionOf('INV-NOPE-001', entity, model);
    expect(result.ok ? '' : result.reason).toContain('実在しません');
  });
});
