/**
 * T16 宣言 CHECK の式の出どころ(`lib/data/verifiers/t16-check-expression.ts`)のユニットテスト。
 *
 * 規約網羅(design/check-generation.md §1・§3 / ARCH-SP-BE-0001 §テーブル仕様):
 *   - `invariant` が実在しない行は error
 *   - `rule` と `invariant` の両方があり、`formal` から反映できる式と `rule` が違えば error
 *     (空白の入れ方は見ない)
 *   - `handwritten` の宣言の形 —— 理由が空 / `rule` と同時 / `invariant` 無しは error
 *   - `invariant` だけを宣言する行で式を反映できなければ warning で**理由**を報告する
 *   - 反映できる行・`handwritten` を宣言する行は静か(何も言わない)
 *   - 逆向き: `enforced_by: db_constraint` の `ref` が data_table のどの宣言にも無ければ
 *     warning(CHECK・一意索引・排他制約・**自動命名の外部キー**のどれかに在ればよい)
 */

import { describe, expect, it } from 'vitest';
import { T16_REASONS } from '../../../../lib/data/check-reasons.js';
import { verifyCheckExpression } from '../../../../lib/data/verifiers/t16-check-expression.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, loc, machine, specModel } from '../../../helpers/model-builder.js';
import type { DataCheckDecl } from '../../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../../lib/model/types.js';
import { agentTable, crossDomain, ticketTable } from '../../../helpers/cross-equality-fixture.js';

/** 題材: 予約(booking)。`starts_at < ends_at` が反映できる 1 本。 */
function domain(formal: InvariantFormal = { kind: 'check', expr: 'booking.starts_at < booking.ends_at' }): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        fields: [
          field('starts_at', { kind: 'datetime' }, { required: true }),
          field('ends_at', { kind: 'datetime' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }, { required: true }),
        ],
      }),
      stateMachines: [machine('booking', { states: ['draft', 'done'], initial: 'draft' })],
      invariants: {
        invariants: [
          {
            id: 'INV-BOOKING-002',
            statement: '終了は開始より後',
            entities: ['booking'],
            formal,
            enforcedBy: [],
            location: loc('docs/specs/domain/booking/invariants.md'),
          },
        ],
        location: loc('docs/specs/domain/booking/invariants.md'),
      },
    }),
  ]);
}

/** `enforced_by: db_constraint` を 1 本だけ持つ不変条件のモデル(`checks[]` は置かない)。 */
function withEnforcement(
  ref: string,
  kind: 'db_constraint' | 'trigger' = 'db_constraint',
  formal?: InvariantFormal,
): SpecModel {
  const model = domain(formal);
  const invariants = model.aggregates.get('booking')?.invariants?.invariants ?? [];
  const aggregates = new Map(model.aggregates);
  const specs = model.aggregates.get('booking');
  if (specs !== undefined && specs.invariants !== undefined) {
    aggregates.set('booking', {
      ...specs,
      invariants: {
        ...specs.invariants,
        invariants: invariants.map((invariant) => ({
          ...invariant,
          enforcedBy: [{ kind, ref, location: loc('docs/specs/domain/booking/invariants.md') }],
        })),
      },
    });
  }
  return { ...model, aggregates };
}

/** `checks[]` を 1 行だけ持つ表で検査する。 */
function findings(check: DataCheckDecl, model: SpecModel = domain()) {
  return verifyCheckExpression(model, dataTableModel([dataTable('bookings', { entity: 'booking', checks: [check] })]));
}

describe('T16 宣言 CHECK の式の出どころ', () => {
  it('invariant だけを宣言し、式が反映できる行には何も言わない', () => {
    expect(findings({ name: 'bookings_period_check', invariant: 'INV-BOOKING-002' })).toEqual([]);
  });

  it('handwritten を理由つきで宣言する行には何も言わない', () => {
    expect(
      findings({
        name: 'bookings_period_check',
        invariant: 'INV-BOOKING-002',
        handwritten: '適用済みの手書き migration が作っている執行点である',
      }),
    ).toEqual([]);
  });

  it('実在しない invariant は error', () => {
    const found = findings({ name: 'bookings_period_check', invariant: 'INV-NOPE-001' });
    expect(found.map((f) => f.severity)).toEqual(['error']);
    expect(found[0]?.message).toContain('実在しません');
  });

  it('rule と formal から反映できる式が違えば error', () => {
    const found = findings({
      name: 'bookings_period_check',
      invariant: 'INV-BOOKING-002',
      rule: 'starts_at < ends_at',
    });
    expect(found.map((f) => f.severity)).toEqual(['error']);
    expect(found[0]?.message).toContain('一致しません');
  });

  it('rule が反映できる式と同じなら(空白の入れ方は見ない)何も言わない', () => {
    expect(
      findings({
        name: 'bookings_period_check',
        invariant: 'INV-BOOKING-002',
        rule: 'COALESCE( (starts_at < ends_at), false )',
      }),
    ).toEqual([]);
  });

  it('handwritten が空なら error', () => {
    const found = findings({ name: 'bookings_period_check', invariant: 'INV-BOOKING-002', handwritten: '  ' });
    expect(found.map((f) => f.severity)).toEqual(['error']);
    expect(found[0]?.message).toContain('handwritten が空です');
  });

  it('rule と handwritten を同時に宣言すれば error', () => {
    const found = findings({
      name: 'bookings_period_check',
      invariant: 'INV-BOOKING-002',
      rule: 'starts_at < ends_at',
      handwritten: '手書きに残す',
    });
    expect(found.some((f) => f.message.includes('同時に宣言しています'))).toBe(true);
  });

  it('invariant を宣言しない行の handwritten は error(生成する式がそもそも無い)', () => {
    const found = findings({ name: 'bookings_free_check', handwritten: '手書きに残す' });
    expect(found.map((f) => f.severity)).toEqual(['error']);
    expect(found[0]?.message).toContain('invariant を宣言せずに');
  });

  it('enforced_by の db_constraint が data_table のどこにも無ければ warning で報告する', () => {
    const model = withEnforcement('documents_archive_sync');
    const found = verifyCheckExpression(model, dataTableModel([dataTable('bookings', { entity: 'booking' })]));
    expect(found.map((f) => f.severity)).toEqual(['warning']);
    expect(found[0]?.message).toContain('実在しない執行点である');
  });

  it('実在しない執行点の警告は、不変条件の形式定義の種別を反例に持つ(拡張候補の絞りが読む)', () => {
    const found = verifyCheckExpression(withEnforcement('documents_archive_sync'), dataTableModel([dataTable('bookings', { entity: 'booking' })]));
    expect(found[0]?.counterexample).toEqual({ invariant: 'INV-BOOKING-002', ref: 'documents_archive_sync', kind: 'db_constraint', formal: 'check' });
  });

  it('実在しない執行点の警告は、理由を明示の欄で持つ(拡張候補の絞りが読む)', () => {
    const reasonOf = (kind: 'db_constraint' | 'trigger', formal: InvariantFormal | undefined) =>
      verifyCheckExpression(withEnforcement('missing_ref', kind, formal), dataTableModel([dataTable('bookings', { entity: 'booking' })]))[0]?.reason;
    const cardinality: InvariantFormal = { kind: 'cardinality', keys: ['room_id'], max: 3 };

    // トリガで、形式定義が写像の外(数の上限)= 仕組みが組めない側
    expect(reasonOf('trigger', cardinality)).toBe(T16_REASONS.triggerFormalInexpressible);
    // トリガで、写せる形式定義(行内比較)なのに宣言が無い = 製品が直せる側
    expect(reasonOf('trigger', { kind: 'check', expr: 'booking.starts_at < booking.ends_at' })).toBe(T16_REASONS.enforcementUndeclared);
    // トリガで、形式定義が check だが式が別の集約の欄を見る = 別の集約の欄との一致の側
    expect(reasonOf('trigger', { kind: 'check', expr: 'booking.room_id == room.id' })).toBe(T16_REASONS.crossAggregateCheck);
    // 執行点がトリガでなければ、形式定義が写像の外でも製品が直せる側
    expect(reasonOf('db_constraint', cardinality)).toBe(T16_REASONS.enforcementUndeclared);
  });

  it('執行点が data_table の宣言のどれかに在れば静か(CHECK / 一意索引 / 排他制約)', () => {
    const quiet = (ref: string, opts: Parameters<typeof dataTable>[1]) =>
      verifyCheckExpression(
        withEnforcement(ref),
        dataTableModel([dataTable('bookings', { entity: 'booking', ...opts })]),
      );
    expect(
      quiet('bookings_period_check', { checks: [{ name: 'bookings_period_check', rule: 'starts_at < ends_at' }] }),
    ).toEqual([]);
    expect(
      quiet('bookings_room_slot_unique', {
        indexes: [{ name: 'bookings_room_slot_unique', on: ['room_id'], unique: true }],
      }),
    ).toEqual([]);
    expect(
      quiet('bookings_room_slot_exclude', {
        exclusions: [
          { name: 'bookings_room_slot_exclude', keys: ['room_id'], range: ['starts_at', 'ends_at'] },
        ],
      }),
    ).toEqual([]);
  });

  it('宣言に現れない制約(外部キー / 主キー / 導出 CHECK)も執行点として名指せる', () => {
    const quiet = (ref: string, opts: Parameters<typeof dataTable>[1] = {}) =>
      verifyCheckExpression(
        withEnforcement(ref),
        dataTableModel([dataTable('bookings', { entity: 'booking', ...opts })]),
      );
    // 外部キーは data_table に名前を書かない —— 名前は `{表}_{列}_fkey` の規約から組み立てる。
    expect(
      quiet('bookings_room_id_fkey', {
        foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'no_action' }],
      }),
    ).toEqual([]);
    // 主キーと導出 CHECK は宣言に 1 度も現れないが、DB には実在する。
    expect(quiet('bookings_pkey')).toEqual([]);
    expect(quiet('bookings_state_enum')).toEqual([]);
  });

  it('式を反映できない行は warning で理由を報告する', () => {
    const found = findings(
      { name: 'bookings_period_check', invariant: 'INV-BOOKING-002' },
      domain({ kind: 'uniqueness', keys: ['state'] }),
    );
    expect(found.map((f) => f.severity)).toEqual(['warning']);
    expect(found[0]?.message).toContain('formal.type: uniqueness');
    expect(found[0]?.reason).toBe(T16_REASONS.checkNotReflected);
  });
  describe('(e) の「自集約」は、執行点を宣言した表の集約から取る(不変条件が住む集約ではない)', () => {
    /** 不変条件は棚(shelf)に住み、式は棚の欄だけを見る。執行点は存在しない関数を指す。 */
    function shelfDomain(): SpecModel {
      return specModel([
        aggregate('shelf', {
          entity: entitySpec('shelf', { fields: [field('a', { kind: 'integer' }), field('b', { kind: 'integer' })] }),
          invariants: {
            invariants: [
              {
                id: 'INV-SHELF-001',
                statement: '棚の a と b は等しい',
                entities: ['shelf'],
                formal: { kind: 'check', expr: 'shelf.a == shelf.b' },
                enforcedBy: [{ kind: 'trigger', ref: 'missing_fn', location: loc('docs/specs/domain/shelf/invariants.md') }],
                location: loc('docs/specs/domain/shelf/invariants.md'),
              },
            ],
            location: loc('docs/specs/domain/shelf/invariants.md'),
          },
        }),
        aggregate('section', { entity: entitySpec('section', { fields: [field('a', { kind: 'integer' })] }) }),
      ]);
    }
    const trigger = {
      name: 'check_section',
      functionName: 'check_section',
      deferred: false,
      supplies: [],
      params: {},
      invariant: 'INV-SHELF-001',
    };
    const reasonOf = (tables: ReturnType<typeof dataTable>[]) =>
      verifyCheckExpression(shelfDomain(), dataTableModel(tables)).find((f) => f.message.includes('INV-SHELF-001'))?.reason;

    it('区画(section)の表がその不変条件の執行点を宣言していれば、棚の欄は「別の集約の欄」と読む', () => {
      expect(reasonOf([dataTable('sections', { entity: 'section', triggers: [trigger] })])).toBe(
        T16_REASONS.crossAggregateCheck,
      );
    });

    it('どの表も宣言していなければ、住む集約(棚)の綴りに退く(自集約の欄だけなので別集約ではない)', () => {
      expect(reasonOf([dataTable('sections', { entity: 'section' })])).toBe(T16_REASONS.enforcementUndeclared);
    });

    it('棚の表が宣言していれば、住む集約と同じなので別集約ではない', () => {
      expect(reasonOf([dataTable('shelves', { entity: 'shelf', triggers: [trigger] })])).toBe(
        T16_REASONS.enforcementUndeclared,
      );
    });
  });
});

describe('T16 (e) 別の集約の列との等式の執行点', () => {
  it('両端のトリガを宣言した関数が在れば静か(「実在しない執行点である」を報告しない)', () => {
    const found = verifyCheckExpression(crossDomain(), dataTableModel([ticketTable(), agentTable()]));
    expect(found).toEqual([]);
  });

  it('片側の関数が無ければ、その執行点だけを別の集約の等式の理由で報告する', () => {
    const found = verifyCheckExpression(crossDomain(), dataTableModel([ticketTable(), agentTable([])]));
    expect(found.map((finding) => finding.counterexample?.['ref'])).toEqual(['check_ticket_agent_org_on_agent']);
    expect(found[0]?.reason).toBe(T16_REASONS.crossAggregateCheck);
  });

  it('どちらも宣言が無ければ両方を報告する(宣言が嘘にならない)', () => {
    const found = verifyCheckExpression(crossDomain(), dataTableModel([ticketTable([]), agentTable([])]));
    expect(found.map((finding) => finding.counterexample?.['ref'])).toEqual([
      'check_ticket_agent_org',
      'check_ticket_agent_org_on_agent',
    ]);
  });
});
