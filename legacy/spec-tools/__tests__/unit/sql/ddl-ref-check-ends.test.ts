/**
 * 参照の欄が指す行を読む条件の**相手の端**(`ddl-ref-check-ends.ts`)と、不変条件の書き込みの端の覆い(`ddl-ref-check-edges.ts`。fix25s)のユニットテスト。
 *
 * 固定するのは 3 つである:
 *   - 相手の端の本文の字面(錨 = 読む行のうち表名のバイト順で最初の表の行。錨でない表の端は、この行を指す自表の行が指す錨の行を id の順に
 *     掴んで直列化し、錨の表の端は掴まない。点検 D25s2-1。結合して読み直し、前提つきの式を `COALESCE(…, false)` で閉じて不変条件の違反の
 *     語で断る)と、発火(式がその表で読む列の更新のコミット時の制約トリガ)
 *   - 生成しない形(自表の執行点が手書き・名前が重なる)
 *   - 覆いの判定: 片側しか見ない形を名指し、相手の端・CHECK・発火の列で覆われれば消える。列を書き換える別トリガの発火列も端に数える
 */

import { describe, expect, it } from 'vitest';
import { anchorOf, refCounterpartDeclsOf, type RefCheckRow } from '../../../lib/model/data/ref-check-shape.js';
import { anchorRows } from '../../../lib/sql/rpc-anchor-locks.js';
import { refCounterpartTriggersIn } from '../../../lib/sql/ddl-ref-check-ends.js';
import { invariantEdgeGapsOf } from '../../../lib/sql/ddl-ref-check-edges.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import type { EnforcementDef } from '../../../lib/model/types-invariant.js';
import { aggregate, entitySpec, field, loc, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 前提つきの形式定義(題材の既定)。 */
const DEPENDENCY: InvariantFormal = { kind: 'state_dependency', if: 'room.state == closed', then: 'guest.status == verified' };

/** 題材: 予約(booking)は部屋(room)と客(guest)を必須の参照の欄で指す。部屋が閉じていれば客は確認済みでなければならない。 */
function domain(formal: InvariantFormal = DEPENDENCY, enforcedBy: readonly EnforcementDef[] = [{ kind: 'trigger', ref: 'check_booking_guest', location: loc() }]): SpecModel {
  return specModel(
    [
      aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'enum', values: ['open', 'closed'] }, { required: true })] }) }),
      aggregate('guest', { entity: entitySpec('guest', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('status', { kind: 'enum', values: ['new', 'verified'] }, { required: true })] }) }),
      aggregate('booking', {
        entity: entitySpec('booking', {
          context: { room: 'booking.room_id', guest: 'booking.guest_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
            field('guest_id', { kind: 'ref', entity: 'guest' }, { required: true }),
            field('note', { kind: 'string' }),
          ],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOKING-001', entities: ['booking', 'room', 'guest'], statement: '閉じた部屋の予約は確認済みの客だけ', formal, enforcedBy })]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 自表の執行点(既定は正しい宣言)。 */
function trigger(init: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return { name: 'check_booking_guest', functionName: 'check_booking_guest', fires: 'before insert or update of room_id, guest_id', deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-001', ...init };
}

/** 3 つの表(予約の表のトリガと関数・部屋の表のトリガは引数で差し替える)。 */
function tables(opts: { readonly booking?: readonly DataTriggerDecl[]; readonly handwritten?: boolean; readonly rooms?: readonly DataTriggerDecl[] } = {}): readonly DataTableSpec[] {
  const functions = opts.handwritten === true ? [{ name: 'check_booking_guest', args: [], params: [], kind: 'trigger' as const, alsoWrites: [], handwritten: '手書きの理由' }] : [];
  return [
    dataTable('bookings', { entity: 'booking', triggers: [...(opts.booking ?? [trigger()])], functions }),
    dataTable('rooms', { entity: 'room', triggers: [...(opts.rooms ?? [])] }),
    dataTable('guests', { entity: 'guest' }),
  ];
}

/** 表を名前で引く。 */
function table(all: readonly DataTableSpec[], name: string): DataTableSpec {
  const found = all.find((candidate) => candidate.table === name);
  if (found === undefined) throw new Error(name);
  return found;
}

describe('相手の端の制約トリガ', () => {
  it('読む行が 2 つなら、錨でない表(部屋)の端は、その行を指す予約が指す錨(客)の行を id の順に共有で掴んでから(D25s2-1)、結合して読み直し、前提つきの式で断る本文になる', () => {
    const all = tables();
    const [built] = refCounterpartTriggersIn(table(all, 'rooms'), domain(), all);
    expect(built?.name).toBe('check_booking_guest_on_room');
    expect(built?.fires).toBe('after update of state');
    expect(built?.deferred).toBe(true);
    expect(built?.function.securityDefiner).toBe(true);
    expect(built?.function.body.slice(5)).toEqual([
      'perform 1',
      'from public.bookings t, public.guests v_anchor',
      'where t.room_id = new.id',
      '  and v_anchor.id = t.guest_id',
      'order by v_anchor.id',
      'for share of v_anchor;',
      'declare',
      '    v_count integer;',
      'begin',
      '    select count(*) into v_count',
      '    from public.bookings t',
      '    join public.guests v_guests on v_guests.id = t.guest_id',
      '    join public.rooms v_rooms on v_rooms.id = t.room_id',
      "    where t.room_id = new.id and not (COALESCE(((NOT (v_rooms.state = 'closed'::text)) OR (v_guests.status = 'verified'::text)), false));",
      '    if v_count > 0 then',
      '        raise exception using',
      "            message = 'roomのstateを変えられません。この決まりに合わないbookingが ' || v_count::text || ' 件あります(閉じた部屋の予約は確認済みの客だけ)',",
      "            errcode = 'check_violation',",
      "            constraint = 'check_booking_guest_on_room',",
      "            detail = 'check_booking_guest_on_room: INV-BOOKING-001: ' || v_count::text;",
      '    end if;',
      'end;',
      'return null;',
    ]);
    expect(built?.function.body[0]).toBe("if current_setting('transaction_isolation') <> 'read committed' then");
    expect(refCounterpartTriggersIn(table(all, 'guests'), domain(), all).map((end) => `${end.name} ${end.fires}`)).toEqual(['check_booking_guest_on_guest after update of status']);
    // 錨の表(客)の端は新しく掴まない(自分の更新が客の行を掴んだままコミットする)。advisory lock の鍵は取らない。
    const [guestEnd] = refCounterpartTriggersIn(table(all, 'guests'), domain(), all);
    expect(guestEnd?.function.body.join('\n')).not.toMatch(/for share|for update|pg_advisory_xact_lock/);
    expect(built?.function.body.join('\n')).not.toContain('pg_advisory_xact_lock');
  });

  it('読む行が 1 つなら錨の表の端しか無く、掴まない(自表の側の執行点がその行を共有で読む)', () => {
    const all = tables();
    const [built] = refCounterpartTriggersIn(table(all, 'guests'), domain({ kind: 'check', expr: 'guest.status == verified' }), all);
    expect(built?.function.body.join('\n')).not.toMatch(/for share|for update|pg_advisory_xact_lock/);
    expect(refCounterpartTriggersIn(table(all, 'rooms'), domain({ kind: 'check', expr: 'guest.status == verified' }), all)).toEqual([]);
  });

  it('錨は読む行の最初の表で、共有で掴む(読む行は 2 つまで。3 つ以上は判定が断る = D25s3-1)', () => {
    const row = (table: string, column: string): RefCheckRow => ({ entity: entitySpec(table), table, column, variable: `v_${table}`, root: table });
    const [a, b] = [row('a_rows', 'a_id'), row('b_rows', 'b_id')];
    const plan = (rows: readonly RefCheckRow[]): Parameters<typeof anchorOf>[0] => ({ invariant: invariant({ id: 'INV-X-001' }), rows, gate: null });
    expect(anchorOf(plan([a, b]), a)).toBeNull();
    expect(anchorOf(plan([a, b]), b)).toEqual({ row: a, strength: 'share' });
    expect(anchorOf(plan([a]), a)).toBeNull();
    // 同じ表を別の参照の欄で 2 度読むなら、錨でない欄の端は錨の行を掴む(表の名前だけでは錨と言わない)。
    expect(anchorOf(plan([a, row('a_rows', 'a2_id')]), row('a_rows', 'a2_id'))).toEqual({ row: a, strength: 'share' });
  });

  it('定型 RPC の先掴み: 錨でない表の更新は、その行を指す自表の行が指す錨の行を id の順に掴む(発火しない列・錨の表・作成は足さない)', () => {
    const all = tables();
    const rooms = table(all, 'rooms');
    const base = { name: 'apply_room_transition', table: rooms, tables: all, targetId: 'p_room_id', domain: domain() } as const;
    expect(anchorRows({ ...base, shape: 'transition', writtenColumns: ['state'] }, 2)).toEqual([
      {
        table: 'guests',
        alias: 'c2',
        from: ['public.bookings c2_h', 'public.guests c2'],
        where: ['c2_h.room_id = p_room_id', 'c2.id = c2_h.guest_id'],
        mode: 'share',
        idKey: null,
        ordered: true,
      },
    ]);
    expect(anchorRows({ ...base, shape: 'update', writtenColumns: null }, 0)).toHaveLength(1);
    expect(anchorRows({ ...base, shape: 'transition', writtenColumns: ['note'] }, 0)).toEqual([]);
    expect(anchorRows({ ...base, shape: 'create' }, 0)).toEqual([]);
    expect(anchorRows({ ...base, table: table(all, 'guests'), shape: 'transition', writtenColumns: ['status'] }, 0)).toEqual([]);
    expect(anchorRows({ name: base.name, table: rooms, tables: all, targetId: 'p_room_id', shape: 'transition' }, 0)).toEqual([]);
  });

  it('宣言の形に写す(突合とハンドブックが読む)', () => {
    const all = tables();
    expect(refCounterpartDeclsOf(table(all, 'rooms'), domain(), all)).toEqual({
      triggers: [{ name: 'check_booking_guest_on_room', functionName: 'check_booking_guest_on_room', fires: 'after update of state (constraint trigger, deferrable initially deferred)', deferred: true, supplies: [], params: {}, invariant: 'INV-BOOKING-001' }],
      functions: [{ name: 'check_booking_guest_on_room', args: [], params: [], kind: 'trigger', alsoWrites: [], security: 'definer', lookup: [] }],
    });
  });

  it.each([
    ['自表の執行点が手書き', tables({ handwritten: true })],
    ['相手の表に同じ名前のトリガが在る', tables({ rooms: [{ name: 'check_booking_guest_on_room', functionName: 'x', fires: 'before insert', deferred: false, supplies: [], params: {} }] })],
  ] as const)('生成しない: %s', (_title, all) => {
    expect(refCounterpartTriggersIn(table(all, 'rooms'), domain(), all)).toEqual([]);
  });
});

describe('不変条件の書き込みの端の覆い', () => {
  it('相手の端が生成されれば、自表の執行点が見ない列だけが残る', () => {
    const all = tables({ booking: [trigger({ fires: 'before insert or update of guest_id' })] });
    expect(invariantEdgeGapsOf(domain(), all)).toEqual([{ invariant: 'INV-BOOKING-001', table: 'bookings', edge: 'update of room_id' }]);
  });

  it('自表の執行点が手書きなら相手の端も無く、相手の表の列の更新が名指される', () => {
    expect(invariantEdgeGapsOf(domain(), tables({ handwritten: true }))).toEqual([
      { invariant: 'INV-BOOKING-001', table: 'guests', edge: 'update of status' },
      { invariant: 'INV-BOOKING-001', table: 'rooms', edge: 'update of state' },
    ]);
  });

  it('執行点が 1 つも無ければ、挿入も名指される', () => {
    const gaps = invariantEdgeGapsOf(domain(DEPENDENCY, []), tables({ booking: [] }));
    expect(gaps.map((gap) => `${gap.table} ${gap.edge}`)).toEqual(['bookings insert', 'bookings update of guest_id', 'bookings update of room_id', 'guests update of status', 'rooms update of state']);
  });

  it('自表だけを読む式は、CHECK(db_constraint)ならどの更新も覆う。発火の列が足りないトリガは足りない列を名指す', () => {
    const own: InvariantFormal = { kind: 'check', expr: 'booking.note != booking.note or booking.room_id is not null' };
    expect(invariantEdgeGapsOf(domain(own, [{ kind: 'db_constraint', ref: 'bookings_check', location: loc() }]), tables({ booking: [] }))).toEqual([]);
    expect(invariantEdgeGapsOf(domain(own), tables({ booking: [trigger({ fires: 'before insert or update of note' })] }))).toEqual([{ invariant: 'INV-BOOKING-001', table: 'bookings', edge: 'update of room_id' }]);
  });

  it('読む列を書き換える別トリガの発火列も端に数える', () => {
    const own: InvariantFormal = { kind: 'check', expr: 'booking.note != booking.note or booking.room_id is not null' };
    const filler: DataTriggerDecl = { name: 'apply_note', functionName: 'apply_note', fires: 'before update of guest_id', deferred: false, supplies: ['note'], params: {} };
    const gaps = invariantEdgeGapsOf(domain(own), tables({ booking: [filler, trigger({ fires: 'before insert or update of note, room_id' })] }));
    expect(gaps).toEqual([{ invariant: 'INV-BOOKING-001', table: 'bookings', edge: 'update of guest_id' }]);
  });
});
