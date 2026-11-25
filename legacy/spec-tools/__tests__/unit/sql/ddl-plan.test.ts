/**
 * 表の DDL の計画(`lib/sql/ddl-plan.ts`)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様 / design/ddl-generation.md §2 写像):
 *   - 列の型は `columnType` の写像そのままである
 *   - NOT NULL は「行で必ず値がある」— `required` / `auto` / `state` 型 / 宣言された既定値
 *   - 既定値は 3 通りの導出(`auto` + uuid / `auto` + datetime / state の初期状態)と
 *     data_table の `defaults`(宣言が導出に優先する)
 *   - 導出 CHECK は 4 語に固定した名前(`_max_length` / `_range` / `_enum` / `_pattern`)で、
 *     式は `pg_get_constraintdef` の字面に合わせる(`enum` と `state` はどちらも `_enum`)
 *   - `min` / `max` の 4 通り(両方 / 下限だけ / 上限だけ / 無し)
 *   - 制約が効かない型(数値の `max_length`・文字列の `min`)からは CHECK が出ない
 *   - 非導出 CHECK の式の出どころは 3 通り —— `rule`(丸括弧に包む)/ 由来の不変条件の
 *     `formal`(正準表記に写す)/ `handwritten` を宣言する行と写せない行は式を持たない
 *   - 外部キーの制約名は `{表}_{列}_fkey`、ON DELETE は SQL の語に直す
 *   - 外部キーは**両側の表のファイル**に出る(相互参照も解ける。存在ガードで先の側は通り過ぎる)
 *   - `entity` を持たない表・引けない `entity` では計画が無い(null)
 */

import { describe, expect, it } from 'vitest';
import { tableDdlPlan } from '../../../lib/sql/ddl-plan.js';
import { urlRegexSource } from '../../../lib/kernel/url-format.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { aggregate, entitySpec, loc, machine, specModel } from '../../helpers/model-builder.js';
import type { FieldDef, FieldType, SpecModel } from '../../../lib/model/types.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';

/** 制約つきの欄を 1 つ作る(共有ヘルパーは制約を扱わないので、ここでリテラル構築する)。 */
function col(name: string, type: FieldType, opts: Partial<FieldDef> = {}): FieldDef {
  return {
    name,
    type,
    required: false,
    auto: false,
    personal: false,
    session: false,
    location: loc('docs/specs/domain/booking/entity.md', `fields.${name}`),
    ...opts,
  };
}

/** 題材: 予約(booking)。状態機械 1 つ(`draft` → `done`)と、行の CHECK に反映できる不変条件 1 本。 */
function domain(fields: readonly FieldDef[]): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', { fields }),
      stateMachines: [machine('booking', { states: ['draft', 'done'], initial: 'draft' })],
      invariants: {
        invariants: [
          {
            id: 'INV-BOOKING-002',
            statement: '終了は開始より後',
            entities: ['booking'],
            formal: { kind: 'check', expr: 'booking.starts_at < booking.ends_at' },
            enforcedBy: [],
            location: loc('docs/specs/domain/booking/invariants.md'),
          },
        ],
        location: loc('docs/specs/domain/booking/invariants.md'),
      },
    }),
  ]);
}

/** 予約の表(`ddl_migration` は外部キーの置き場の判定に要るので既定で持たせる)。 */
function table(opts: Partial<DataTableSpec> = {}): DataTableSpec {
  return dataTable('bookings', {
    entity: 'booking',
    ddlMigration: '20260912120204_ddl_bookings.sql',
    ...opts,
  });
}

/** 計画(必ず引ける前提の短縮形)。 */
function plan(fields: readonly FieldDef[], opts: Partial<DataTableSpec> = {}) {
  const own = table(opts);
  const built = tableDdlPlan(own, domain(fields), [own]);
  if (built === null) throw new Error('計画が組み立てられませんでした');
  return built;
}

describe('表の DDL の計画', () => {
  it('列の型・NOT NULL・既定値を entity_spec から導く', () => {
    const built = plan([
      col('id', { kind: 'uuid' }, { auto: true }),
      col('title', { kind: 'string' }, { required: true, description: '件名' }),
      col('note', { kind: 'text' }),
      col('state', { kind: 'state', machine: 'booking' }),
      col('created_at', { kind: 'datetime' }, { auto: true }),
    ]);
    expect(built.columns).toEqual([
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', identity: false, comment: null },
      { name: 'title', type: 'text', notNull: true, default: null, identity: false, comment: '件名' },
      { name: 'note', type: 'text', notNull: false, default: null, identity: false, comment: null },
      { name: 'state', type: 'text', notNull: true, default: "'draft'::text", identity: false, comment: null },
      { name: 'created_at', type: 'timestamptz', notNull: true, default: 'now()', identity: false, comment: null },
    ]);
    expect(built.primaryKey).toEqual(['id']);
  });

  it('宣言された既定値は導出に優先し、その列は NOT NULL になる', () => {
    const built = plan([col('paid', { kind: 'boolean' })], { defaults: { paid: 'false' } });
    expect(built.columns).toEqual([
      { name: 'paid', type: 'boolean', notNull: true, default: 'false', identity: false, comment: null },
    ]);
  });

  it('導出 CHECK の名前は 4 語に固定され、式は pg_get_constraintdef の字面に合う', () => {
    const built = plan([
      col('title', { kind: 'string' }, { maxLength: 80 }),
      col('code', { kind: 'string' }, { pattern: '^[A-Z]+$' }),
      col('seats', { kind: 'integer' }, { min: 1, max: 50 }),
      col('purpose', { kind: 'enum', values: ['meeting', 'other'] }),
      col('state', { kind: 'state', machine: 'booking' }),
    ]);
    expect(built.derivedChecks.map((check) => [check.name, check.expression])).toEqual([
      ['bookings_title_max_length', '(char_length(title) <= 80)'],
      ['bookings_code_pattern', "(code ~ '^[A-Z]+$'::text)"],
      ['bookings_seats_range', '((seats >= 1) AND (seats <= 50))'],
      ["bookings_purpose_enum", "(purpose = ANY (ARRAY['meeting'::text, 'other'::text]))"],
      // state も enum も「値の値域」なので同じ `_enum`(`bookings_state_state` は作らない)。
      ['bookings_state_enum', "(state = ANY (ARRAY['draft'::text, 'done'::text]))"],
    ]);
  });

  it('format: url は URL の綴りの pattern の CHECK になる(名前は pattern と同じ。両方を同時には持てない)', () => {
    const built = plan([col('ticket_url', { kind: 'string' }, { format: 'url', maxLength: 500 })]);
    expect(built.derivedChecks.map((check) => [check.name, check.expression])).toEqual([
      ['bookings_ticket_url_max_length', '(char_length(ticket_url) <= 500)'],
      ['bookings_ticket_url_pattern', `(ticket_url ~ '${urlRegexSource('http_https')}'::text)`],
    ]);
  });

  it('min / max は 4 通り(両方・下限だけ・上限だけ・無し)', () => {
    const built = plan([
      col('low', { kind: 'integer' }, { min: 0 }),
      col('high', { kind: 'integer' }, { max: 9 }),
      col('free', { kind: 'integer' }),
    ]);
    expect(built.derivedChecks.map((check) => [check.name, check.expression])).toEqual([
      ['bookings_low_range', '(low >= 0)'],
      ['bookings_high_range', '(high <= 9)'],
    ]);
  });

  it('制約が効かない型からは CHECK が出ない', () => {
    // max_length / pattern は文字列だけ、min / max は数値だけに効く(zod の生成と同じ 1 本)。
    const built = plan([
      col('seats', { kind: 'integer' }, { maxLength: 3, pattern: '^\\d+$' }),
      col('title', { kind: 'string' }, { min: 1, max: 5 }),
    ]);
    expect(built.derivedChecks).toEqual([]);
  });

  it('非導出 CHECK の式は rule か、由来の不変条件の formal から来る', () => {
    const built = plan(
      [
        col('id', { kind: 'uuid' }, { auto: true }),
        col('starts_at', { kind: 'datetime' }, { required: true }),
        col('ends_at', { kind: 'datetime' }, { required: true }),
      ],
      {
        checks: [
          { name: 'bookings_period_check', invariant: 'INV-BOOKING-002' },
          { name: 'bookings_seats_positive', rule: 'seats > 0' },
        ],
      },
    );
    expect(built.declaredChecks).toEqual([
      // 式の正は invariant_spec にあり、字面は `pg_get_constraintdef` の印字に合わせる。
      {
        name: 'bookings_period_check',
        expression: 'COALESCE((starts_at < ends_at), false)',
        invariant: 'INV-BOOKING-002',
      },
      // 素の式は計画の段で包む(包まないと `check seats > 0` という流せない SQL になる)。
      { name: 'bookings_seats_positive', expression: '(seats > 0)', invariant: null },
    ]);
  });

  it('handwritten を宣言する行と、式を反映できない行は式を持たない(DDL は制約を作らない)', () => {
    const built = plan([col('id', { kind: 'uuid' }, { auto: true })], {
      checks: [
        { name: 'bookings_period_check', invariant: 'INV-BOOKING-002', handwritten: '手書きの migration が作る' },
        { name: 'bookings_quota_check', invariant: 'INV-BOOKING-003' },
      ],
    });
    expect(built.declaredChecks).toEqual([
      { name: 'bookings_period_check', expression: null, invariant: 'INV-BOOKING-002' },
      // 実在しない不変条件(= 式の正がどこにも無い)は反映しない。理由は T16 が報告する。
      { name: 'bookings_quota_check', expression: null, invariant: 'INV-BOOKING-003' },
    ]);
  });

  it('外部キーの制約名は {表}_{列}_fkey で、ON DELETE は SQL の語になる', () => {
    const built = plan([col('id', { kind: 'uuid' }, { auto: true })], {
      foreignKeys: [
        { column: 'room_id', references: 'rooms', onDelete: 'no_action' },
        { column: 'id', references: 'auth.users', onDelete: 'cascade' },
      ],
    });
    expect(built.foreignKeys).toEqual([
      {
        name: 'bookings_room_id_fkey',
        table: 'bookings',
        column: 'room_id',
        references: 'rooms',
        onDelete: 'no action',
      },
      { name: 'bookings_id_fkey', table: 'bookings', column: 'id', references: 'auth.users', onDelete: 'cascade' },
    ]);
  });

  it('索引・排他制約は宣言をそのまま運ぶ', () => {
    const built = plan([col('id', { kind: 'uuid' }, { auto: true })], {
      indexes: [{ name: 'bookings_room_id_idx', on: ['room_id'], unique: false }],
      exclusions: [
        {
          name: 'bookings_room_slot_exclude',
          keys: ['room_id'],
          range: ['starts_at', 'ends_at'],
          where: "state <> 'cancelled'",
          invariant: 'INV-BOOKING-001',
        },
      ],
    });
    expect(built.indexes).toEqual([
      { name: 'bookings_room_id_idx', columns: ['room_id'], unique: false, where: null },
    ]);
    expect(built.exclusions).toEqual([
      {
        name: 'bookings_room_slot_exclude',
        keys: ['room_id'],
        range: ['starts_at', 'ends_at'],
        where: "state <> 'cancelled'",
        invariant: 'INV-BOOKING-001',
      },
    ]);
  });

  it('supplied_by: db の欄は NOT NULL にしない(裁定 2026-09-22)', () => {
    // 供給するトリガが**空を書くことがある**(写しの欄は元が空なら空のまま入る)ので、
    // `triggers[].supplies` を NOT NULL の根拠にしない。`isInputAbsent` に取り替える回帰を止める。
    const built = plan([
      col('note', { kind: 'text' }, { suppliedBy: 'db' }),
      col('label', { kind: 'string' }, { suppliedBy: 'db', required: true }),
    ], {
      triggers: [
        {
          name: 'fill_booking',
          functionName: 'fill_booking',
          deferred: false,
          supplies: ['note', 'label'],
          params: {},
        },
      ],
    });
    expect(built.columns.map((column) => [column.name, column.notNull])).toEqual([
      ['note', false],
      ['label', true],
    ]);
  });

  it('required: false + defaults の欄は NOT NULL になる(row のスキーマとの唯一の差)', () => {
    const built = plan([col('memo', { kind: 'text' })], { defaults: { memo: "''::text" } });
    expect(built.columns).toEqual([
      { name: 'memo', type: 'text', notNull: true, default: "''::text", identity: false, comment: null },
    ]);
  });

  it('enum の値と pattern は SQL リテラルとしてエスケープされる', () => {
    const built = plan([
      col('mood', { kind: 'enum', values: ["it's fine"] }),
      col('code', { kind: 'string' }, { pattern: "^[a-z']+$" }),
    ]);
    expect(built.derivedChecks.map((check) => check.expression)).toEqual([
      "(mood = ANY (ARRAY['it''s fine'::text]))",
      "(code ~ '^[a-z'']+$'::text)",
    ]);
  });

  it('相互参照する 2 表の外部キーは、両方のファイルに 2 本とも出る', () => {
    // 番号で依存順を表そうとすると循環が解けないので、置き場のほうで解く —— 両側に出して、
    // 相手の表がまだ無いあいだは存在ガードで通り過ぎる(`ddl-migration.ts`)。
    const model = specModel([
      aggregate('member', { entity: entitySpec('member', { fields: [col('id', { kind: 'uuid' })] }) }),
      aggregate('invitation', { entity: entitySpec('invitation', { fields: [col('id', { kind: 'uuid' })] }) }),
    ]);
    const members = dataTable('members', {
      entity: 'member',
      ddlMigration: '20260912120201_ddl_members.sql',
      foreignKeys: [{ column: 'invited_via', references: 'invitations', onDelete: 'no_action' }],
    });
    const invitations = dataTable('invitations', {
      entity: 'invitation',
      ddlMigration: '20260912120202_ddl_invitations.sql',
      foreignKeys: [{ column: 'issued_by', references: 'members', onDelete: 'no_action' }],
    });
    const tables = [members, invitations];

    const both: readonly [string, string][] = [
      ['invitations', 'issued_by'],
      ['members', 'invited_via'],
    ];
    expect(tableDdlPlan(members, model, tables)?.foreignKeys.map((fk) => [fk.table, fk.column])).toEqual(
      both,
    );
    expect(
      tableDdlPlan(invitations, model, tables)?.foreignKeys.map((fk) => [fk.table, fk.column]),
    ).toEqual(both);
  });

  it('entity を持たない表・引けない entity では計画が無い', () => {
    const model = domain([col('id', { kind: 'uuid' }, { auto: true })]);
    expect(tableDdlPlan(dataTable('jobs', { internal: true }), model)).toBeNull();
    expect(tableDdlPlan(dataTable('bookings', { entity: 'unknown' }), model)).toBeNull();
    // モデルの形そのものは壊れていない(この検査は data_table 側の宣言だけを見る)。
    expect(dataTableModel([table()]).tables).toHaveLength(1);
  });
});
