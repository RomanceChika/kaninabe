/**
 * T5(排他制約の接地)のユニットテスト。
 *
 * 規約網羅(domain-spec-writing.md §invariant_spec / ARCH-SP-BE-0001 §排他制約):
 *   - `formal.type: exclusion` は db_constraint の執行点を持ち、その ref が宣言された排他制約であること
 *   - 排他制約の `invariant` が実在し、その形式定義が exclusion であること
 *   - 宣言の中身(`keys` / `range` は値まで、`where` は同じ条件であることまで)が両側で一致していること
 */

import { describe, expect, it } from 'vitest';
import { verifyExclusionGrounding } from '../../../../lib/data/verifiers/t5-exclusion-grounding.js';
import { aggregate, entitySpec, loc, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import type { DataExclusionDecl } from '../../../../lib/model/data/types-shape.js';
import type { InvariantDef, InvariantSpec } from '../../../../lib/model/types.js';

/** 予約の重なり禁止(既定の健全な宣言)。 */
function invariant(overrides: Partial<InvariantDef> = {}): InvariantSpec {
  const base: InvariantDef = {
    id: 'INV-BOOKING-001',
    statement: '同じ部屋の同じ時間帯に、取消でない予約は 1 つしか存在しない',
    entities: ['booking'],
    formal: { kind: 'exclusion', keys: ['room_id'], range: ['starts_at', 'ends_at'] },
    enforcedBy: [{ kind: 'db_constraint', ref: 'bookings_room_slot_exclude', location: loc('x.md') }],
    location: loc('docs/specs/domain/booking/invariants.md', 'invariants.INV-BOOKING-001'),
    ...overrides,
  };
  return { invariants: [base], location: loc('docs/specs/domain/booking/invariants.md') };
}

/** 排他制約の宣言(既定は不変条件と一致する)。 */
function exclusion(overrides: Partial<DataExclusionDecl> = {}): DataExclusionDecl {
  return {
    name: 'bookings_room_slot_exclude',
    keys: ['room_id'],
    range: ['starts_at', 'ends_at'],
    invariant: 'INV-BOOKING-001',
    ...overrides,
  };
}

/** booking の集約 1 つだけのドメインモデル。 */
function domain(spec: InvariantSpec) {
  return specModel([aggregate('booking', { entity: entitySpec('booking'), invariants: spec })]);
}

/** bookings の data_table 1 つだけのモデル。 */
function tables(exclusions: readonly DataExclusionDecl[]) {
  return dataTableModel([dataTable('bookings', { entity: 'booking', exclusions })]);
}

describe('T5: 排他制約 ⇔ 不変条件', () => {
  it('宣言が両側で揃っていれば違反なし', () => {
    expect(verifyExclusionGrounding(domain(invariant()), tables([exclusion()]))).toEqual([]);
  });

  it('db_constraint の執行点が無ければエラー', () => {
    const spec = invariant({ enforcedBy: [{ kind: 'guard', ref: 'booking.confirm', location: loc('x.md') }] });

    const findings = verifyExclusionGrounding(domain(spec), tables([exclusion()]));

    expect(findings.some((f) => f.message.includes('db_constraint の執行点がありません'))).toBe(true);
  });

  it('執行点の名前に対応する排他制約の宣言が無ければエラー(一意索引に書いても通らない)', () => {
    const findings = verifyExclusionGrounding(domain(invariant()), tables([]));

    expect(findings.some((f) => f.message.includes('対応する排他制約の宣言がありません'))).toBe(true);
  });

  it('keys が食い違えばエラー(名前だけ合っていて中身がずれた宣言を通さない)', () => {
    const findings = verifyExclusionGrounding(domain(invariant()), tables([exclusion({ keys: ['department_id'] })]));

    expect(findings.some((f) => f.message.includes('keys'))).toBe(true);
  });

  it('range が食い違えばエラー', () => {
    const findings = verifyExclusionGrounding(
      domain(invariant()),
      tables([exclusion({ range: ['ends_at', 'starts_at'] })]),
    );

    expect(findings.some((f) => f.message.includes('range'))).toBe(true);
  });

  it('片方だけが部分制約ならエラー(「取消も含めて禁止」と「取消は対象外」は正反対である)', () => {
    const findings = verifyExclusionGrounding(
      domain(invariant()),
      tables([exclusion({ where: "state <> 'cancelled'" })]),
    );

    expect(findings.map((finding) => finding.message)).toEqual([
      "排他制約 bookings_room_slot_exclude の where(state <> 'cancelled')が INV-BOOKING-001 の formal.where(なし)と同じ条件ではありません",
    ]);
  });

  it('両側に部分制約があれば、式の綴りが違っても同じ条件なら通す(閉じた原子に読み替えて比べる)', () => {
    const spec = invariant({
      formal: { kind: 'exclusion', keys: ['room_id'], range: ['starts_at', 'ends_at'], where: 'state not in [cancelled]' },
    });

    const findings = verifyExclusionGrounding(domain(spec), tables([exclusion({ where: "state <> 'cancelled'" })]));

    expect(findings).toEqual([]);
  });

  it('排他制約に由来の不変条件が無ければエラー', () => {
    const declared = exclusion();
    const { invariant: _dropped, ...withoutInvariant } = declared;

    const findings = verifyExclusionGrounding(domain(invariant()), tables([withoutInvariant]));

    expect(findings.some((f) => f.message.includes('由来の不変条件(invariant)がありません'))).toBe(true);
  });

  it('由来の不変条件が uniqueness ならエラー(宣言が鍵の一致しか言っていない)', () => {
    const spec = invariant({ formal: { kind: 'uniqueness', keys: ['room_id', 'starts_at', 'ends_at'] } });

    const findings = verifyExclusionGrounding(domain(spec), tables([exclusion()]));

    expect(findings.some((f) => f.message.includes('formal.type: exclusion ではありません'))).toBe(true);
  });

  describe('where は中身まで比べる(A14-3 ②)', () => {
    const FORMAL = { kind: 'exclusion', keys: ['room_id'], range: ['starts_at', 'ends_at'], where: 'state not in [cancelled]' } as const;

    it.each([
      ['同じ条件(不等号)', "state <> 'cancelled'"],
      ['同じ条件(not in)', "state not in ('cancelled')"],
    ])('緑: %s', (_name, where) => {
      expect(verifyExclusionGrounding(domain(invariant({ formal: FORMAL })), tables([exclusion({ where })]))).toEqual([]);
    });

    it('赤: 逆の条件(点検 14 回目 m2 X1 の反例)', () => {
      const findings = verifyExclusionGrounding(domain(invariant({ formal: FORMAL })), tables([exclusion({ where: "state = 'cancelled'" })]));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('同じ条件ではありません');
    });

    it('赤: 値が 1 つ足りない', () => {
      const formal = { ...FORMAL, where: 'state not in [cancelled, closed]' };
      expect(verifyExclusionGrounding(domain(invariant({ formal })), tables([exclusion({ where: "state <> 'cancelled'" })]))).toHaveLength(1);
    });

    it('赤: 読めない形は error(推測で通さない)', () => {
      const findings = verifyExclusionGrounding(domain(invariant({ formal: FORMAL })), tables([exclusion({ where: "lower(state) <> 'cancelled'" })]));
      expect(findings[0]?.message).toContain('比べられる形ではありません');
    });

    it('赤: 片方だけが部分制約', () => {
      expect(verifyExclusionGrounding(domain(invariant({ formal: FORMAL })), tables([exclusion()]))).toHaveLength(1);
    });
  });
});
