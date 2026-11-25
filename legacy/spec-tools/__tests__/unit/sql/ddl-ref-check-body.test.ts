/**
 * 参照の欄が指す行の列を見る条件(`ddl-ref-check-body.ts` と `ddl-check-triggers.ts` の配線。fix25s)のユニットテスト。
 *
 * 固定するのは 3 つである:
 *   - `state_dependency`(前提つき)と `check` の式が、参照の欄の行を表名の順に `for share` で読み、`not (前提) or (帰結)` を
 *     `COALESCE(…, false)` で閉じた本文になる(前提を落とした本文は出ない = 宣言と本文が食い違わない)
 *   - 生成しない形は理由つきで断る(空にできる参照の欄・context に無い・参照の欄を埋めるトリガが後に発火する・before insert でない)
 *   - この形でないもの(遅延のトリガ・欄どうしの比較 = 一致の形・自集約の欄だけ)は `none`(従来の経路に任せる)
 */

import { describe, expect, it } from 'vitest';
import { refCheckOf } from '../../../lib/model/data/ref-check-shape.js';
import type { RefCheckJudgement } from '../../../lib/model/data/ref-check-shape.js';
import { checkTriggerOf } from '../../../lib/sql/ddl-check-triggers.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { verifyTriggerBody } from '../../../lib/data/verifiers/t17-trigger-body.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 題材: 予約(booking)は部屋(room)と客(guest)を必須の参照の欄で指す。部屋が閉じていれば客は確認済みでなければならない。 */
function domain(formal: InvariantFormal, opts: { readonly required?: boolean; readonly context?: boolean; readonly desk?: boolean } = {}): SpecModel {
  const desk = opts.desk === true;
  return specModel(
    [
      ...(desk ? [aggregate('desk', { entity: entitySpec('desk', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'enum', values: ['open', 'closed'] }, { required: true })] }) })] : []),
      aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'enum', values: ['open', 'closed'] }, { required: true })] }) }),
      aggregate('guest', { entity: entitySpec('guest', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('status', { kind: 'enum', values: ['new', 'verified'] }, { required: true })] }) }),
      aggregate('booking', {
        entity: entitySpec('booking', {
          context: {
            ...(opts.context === false ? { guest: 'booking.guest_id' } : { room: 'booking.room_id', guest: 'booking.guest_id' }),
            ...(desk ? { desk: 'booking.desk_id' } : {}),
          },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            ...(desk ? [field('desk_id', { kind: 'ref', entity: 'desk' }, { required: true })] : []),
            field('room_id', { kind: 'ref', entity: 'room' }, { required: opts.required ?? true }),
            field('guest_id', { kind: 'ref', entity: 'guest' }, { required: true }),
            field('note', { kind: 'string' }),
          ],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOKING-001', entities: ['booking', 'room', 'guest'], statement: '閉じた部屋の予約は確認済みの客だけ', formal })]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 前提つきの形式定義(題材の既定)。 */
const DEPENDENCY: InvariantFormal = { kind: 'state_dependency', if: 'room.state == closed', then: 'guest.status == verified' };

/** 条件のトリガ(既定は正しい宣言)。 */
function trigger(init: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return { name: 'check_booking_guest', functionName: 'check_booking_guest', fires: 'before insert or update of room_id, guest_id', deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-001', ...init };
}

/** 3 つの表(予約の表のトリガは引数で差し替える)。 */
function tables(bookingTriggers: readonly DataTriggerDecl[] = [trigger()]): readonly DataTableSpec[] {
  return [dataTable('bookings', { entity: 'booking', triggers: [...bookingTriggers] }), dataTable('rooms', { entity: 'room' }), dataTable('guests', { entity: 'guest' }), dataTable('desks', { entity: 'desk' })];
}

/** 判定(予約の表で)。 */
function judge(model: SpecModel, decl: DataTriggerDecl = trigger(), extra: readonly DataTriggerDecl[] = []): RefCheckJudgement {
  const all = tables([...extra, decl]);
  return refCheckOf(decl, all[0] as DataTableSpec, model, all);
}

describe('参照の欄が指す行を読む条件の本文', () => {
  it('同じ表で発火が重なる別の BEFORE トリガが同じ親を排他で掴むなら、その親だけを最初から for update で読む(名前の順の格上げを作らない。点検 D25s-2)', () => {
    const numbering: DataTriggerDecl = { name: 'number_booking', functionName: 'number_booking', fires: 'before insert', deferred: false, supplies: [], params: {}, locks: { rooms: 'update' } };
    const all = tables([trigger(), numbering]);
    const built = checkTriggerOf(trigger(), all[0] as DataTableSpec, domain(DEPENDENCY), all);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body).toContain('    select * into v_rooms from public.rooms r where r.id = new.room_id for update;');
    expect(built.trigger.function.body).toContain('    select * into v_guests from public.guests r where r.id = new.guest_id for share;');
  });

  it('前提つきの条件は、行を表名の順に共有で読み、not (前提) or (帰結) を COALESCE で閉じて断る本文になる', () => {
    const all = tables();
    const built = checkTriggerOf(trigger(), all[0] as DataTableSpec, domain(DEPENDENCY), all);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body).toEqual([
      'declare',
      '    v_guests public.guests;',
      '    v_rooms public.rooms;',
      'begin',
      '    select * into v_guests from public.guests r where r.id = new.guest_id for share;',
      '    select * into v_rooms from public.rooms r where r.id = new.room_id for share;',
      "    if not (COALESCE(((NOT (v_rooms.state = 'closed'::text)) OR (v_guests.status = 'verified'::text)), false)) then",
      '        raise exception using',
      "            message = 'check_booking_guest: INV-BOOKING-001: 閉じた部屋の予約は確認済みの客だけ',",
      "            errcode = 'check_violation',",
      "            constraint = 'check_booking_guest';",
      '    end if;',
      'end;',
      'return new;',
    ]);
    expect(built.trigger.function.securityDefiner).toBe(true);
  });

  it('前提の無い条件(check)は前提を足さない', () => {
    const all = tables();
    const built = checkTriggerOf(trigger(), all[0] as DataTableSpec, domain({ kind: 'check', expr: 'guest.status == verified' }), all);
    expect(built.ok && built.trigger.function.body.join('\n')).toContain("if not (COALESCE((v_guests.status = 'verified'::text), false)) then");
    expect(built.ok && built.trigger.function.body.join('\n')).not.toContain('rooms');
  });

  it.each([
    ['参照の欄が空にできる', domain(DEPENDENCY, { required: false }), trigger(), [], '空にできる参照の欄'],
    ['context に相手が無い', domain(DEPENDENCY, { context: false }), trigger(), [], '1 段の参照の欄で届かない'],
    ['after で発火する', domain(DEPENDENCY), trigger({ fires: 'after insert' }), [], 'before insert'],
    ['削除でも発火する', domain(DEPENDENCY), trigger({ fires: 'before insert or delete' }), [], 'before insert'],
    [
      '参照の欄を埋めるトリガが名前の順で後に発火する',
      domain(DEPENDENCY),
      trigger(),
      [{ name: 'zz_fill_room', functionName: 'zz_fill_room', fires: 'before insert', deferred: false, supplies: ['room_id'], params: {} }],
      '名前の順で先に発火する',
    ],
  ] as const)('生成しない: %s', (_title, model, decl, extra, fragment) => {
    const judged = judge(model, decl, extra);
    expect(judged.kind).toBe('refused');
    expect(judged.kind === 'refused' ? judged.reason : '').toContain(fragment);
  });

  it('読む行が 3 つ以上の条件は生成しない(相手の端が錨を発火ごとに書いた順で掴み、害のない更新どうしでも 40P01 になる。点検 D25s3-1)', () => {
    const three: InvariantFormal = { kind: 'check', expr: 'room.state == open or guest.status == verified or desk.state == open' };
    const judged = judge(domain(three, { desk: true }), trigger({ fires: 'before insert or update of room_id, guest_id, desk_id' }));
    expect(judged.kind).toBe('refused');
    expect(judged.kind === 'refused' ? judged.reason : '').toContain('読む行が 3 つ(desks / guests / rooms)');
    // 2 行までは従来どおり生成する(境界)。
    expect(judge(domain(DEPENDENCY, { desk: true })).kind).toBe('ok');
    // 宣言の時点の赤: T17 が手書きでない宣言を名指す(生成器と同じ判定の 1 本を呼ぶ)。
    const decl = trigger({ fires: 'before insert or update of room_id, guest_id, desk_id' });
    const all = tables([decl]).map((entry) =>
      entry.table === 'bookings' ? { ...entry, functions: [{ name: decl.functionName, args: [], params: [], kind: 'trigger' as const, alsoWrites: [], lookup: [] }] } : entry,
    );
    const findings = verifyTriggerBody(domain(three, { desk: true }), dataTableModel(all), undefined, TEST_ROOTS);
    expect(findings.map((entry) => `${entry.verifier}:${entry.location.pointer ?? ''}`)).toEqual(['T17:functions.check_booking_guest']);
  });

  it('参照の欄を埋めるトリガが名前の順で先に発火するなら通す', () => {
    const supplier: DataTriggerDecl = { name: 'apply_room', functionName: 'apply_room', fires: 'before insert', deferred: false, supplies: ['room_id'], params: {} };
    expect(judge(domain(DEPENDENCY), trigger(), [supplier]).kind).toBe('ok');
  });

  it.each([
    ['遅延のトリガ', domain(DEPENDENCY), trigger({ deferred: true, fires: 'after insert (constraint trigger, deferrable initially deferred)' })],
    ['欄どうしの比較(一致の形)', domain({ kind: 'check', expr: 'booking.note == guest.status' }), trigger()],
    ['自集約の欄だけ', domain({ kind: 'check', expr: 'booking.note == booking.note' }), trigger()],
  ] as const)('この形でない: %s', (_title, model, decl) => {
    expect(judge(model, decl).kind).toBe('none');
  });

  it('この形でない: 不変条件を名指さない', () => {
    const { invariant: _omitted, ...undeclared } = trigger();
    expect(judge(domain(DEPENDENCY), undeclared).kind).toBe('none');
  });
});

/** 題材: 予約の開始(空にできる)は部屋の開館以降(順序の比較。fix25s)。 */
function orderingDomain(expr: string): SpecModel {
  return specModel(
    [
      aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('opens_at', { kind: 'datetime' }, { required: true })] }) }),
      aggregate('booking', {
        entity: entitySpec('booking', {
          context: { room: 'booking.room_id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('room_id', { kind: 'ref', entity: 'room' }, { required: true }), field('starts_at', { kind: 'datetime' }), field('note', { kind: 'string' })],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOKING-002', entities: ['booking', 'room'], statement: '予約の開始は部屋の開館以降', formal: { kind: 'check', expr } })]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

describe('順序の比較と、本文が読む列の発火(fix25s)', () => {
  const decl = (fires: string): DataTriggerDecl => ({ name: 'check_booking_opens', functionName: 'check_booking_opens', fires, deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-002' });
  const all = (fires: string): readonly DataTableSpec[] => [dataTable('bookings', { entity: 'booking', triggers: [decl(fires)] }), dataTable('rooms', { entity: 'room' })];

  it('別の集約の欄との順序の比較(等号でない)は参照の欄が指す行を読む形で、空のときを言い切った式はそのまま本文になる', () => {
    const tables = all('before insert or update of starts_at, room_id');
    const built = checkTriggerOf(decl('before insert or update of starts_at, room_id'), tables[0] as DataTableSpec, orderingDomain('booking.starts_at is null or booking.starts_at >= room.opens_at'), tables);
    expect(built.ok).toBe(true);
    const body = built.ok ? built.trigger.function.body.join('\n') : '';
    expect(body).toContain('select * into v_rooms from public.rooms r where r.id = new.room_id for share;');
    expect(body).toContain('if not (COALESCE(((new.starts_at IS NULL) OR (new.starts_at >= v_rooms.opens_at)), false)) then');
  });

  it('等号の比較は一致の形(この形でない)', () => {
    const tables = all('before insert or update of starts_at, room_id');
    expect(refCheckOf(decl('before insert or update of starts_at, room_id'), tables[0] as DataTableSpec, orderingDomain('booking.starts_at == room.opens_at'), tables).kind).toBe('none');
  });

  it.each([
    ['自表の読む列を落とした発火は生成しない(理由に落とした列)', 'before insert or update of room_id', 'starts_at を見ていない'],
    ['列を名指さない更新は見る列を絞っていない', 'before insert or update', null],
    ['挿入だけの発火は列を絞っていない(更新の端は覆いの検査が見る)', 'before insert', null],
  ] as const)('%s', (_title, fires, fragment) => {
    const tables = all(fires);
    const built = checkTriggerOf(decl(fires), tables[0] as DataTableSpec, orderingDomain('booking.starts_at is null or booking.starts_at >= room.opens_at'), tables);
    if (fragment === null) expect(built.ok).toBe(true);
    else expect(built.ok ? '' : built.reason).toContain(fragment);
  });

  it('自表の列だけの条件も、読む列を落とした発火は生成しない', () => {
    const own = specModel(
      [
        aggregate('booking', {
          entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('note', { kind: 'string' }), field('done', { kind: 'boolean' }, { required: true })] }),
          invariants: invariantSpec([invariant({ id: 'INV-BOOKING-003', entities: ['booking'], statement: '済んだ予約に注記は付けない', formal: { kind: 'check', expr: 'booking.done == false or booking.note is null' } })]),
        }),
      ],
      roleSpec(['anonymous', 'member', 'system']),
    );
    const make = (fires: string): DataTriggerDecl => ({ name: 'check_booking_note', functionName: 'check_booking_note', fires, deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-003' });
    const narrow = make('before insert or update of done');
    const refused = checkTriggerOf(narrow, dataTable('bookings', { entity: 'booking', triggers: [narrow] }), own);
    expect(refused.ok ? '' : refused.reason).toContain('note を見ていない');
    const wide = make('before insert or update of done, note');
    expect(checkTriggerOf(wide, dataTable('bookings', { entity: 'booking', triggers: [wide] }), own).ok).toBe(true);
  });
});

describe('自表の真偽の欄の門(fix25s)', () => {
  /** 題材: 子連れの予約は、子連れ可の部屋だけ(`booking.kids == false or room.kids_ok == true`)。 */
  function kidsDomain(expr: string, kidsRequired = true): SpecModel {
    return specModel(
      [
        aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('kids_ok', { kind: 'boolean' }, { required: true })] }) }),
        aggregate('booking', {
          entity: entitySpec('booking', {
            context: { room: 'booking.room_id' },
            fields: [field('id', { kind: 'uuid' }, { auto: true }), field('room_id', { kind: 'ref', entity: 'room' }, { required: true }), field('kids', { kind: 'boolean' }, { required: kidsRequired })],
          }),
          invariants: invariantSpec([invariant({ id: 'INV-BOOKING-004', entities: ['booking', 'room'], statement: '子連れの予約は子連れ可の部屋だけ', formal: { kind: 'check', expr } })]),
        }),
      ],
      roleSpec(['anonymous', 'member', 'system']),
    );
  }
  const decl: DataTriggerDecl = { name: 'check_booking_kids', functionName: 'check_booking_kids', fires: 'before insert or update of kids, room_id', deferred: false, supplies: [], params: {}, invariant: 'INV-BOOKING-004' };
  const all: readonly DataTableSpec[] = [dataTable('bookings', { entity: 'booking', triggers: [decl] }), dataTable('rooms', { entity: 'room' })];
  const bodyOf = (model: SpecModel): readonly string[] => {
    const built = checkTriggerOf(decl, all[0] as DataTableSpec, model, all);
    return built.ok ? built.trigger.function.body : [];
  };

  it('最上段の or に自表の真偽の欄の項があれば、それが成り立つ行は読まずに通す門を先頭に置く', () => {
    expect(bodyOf(kidsDomain('booking.kids == false or room.kids_ok == true')).slice(0, 4)).toEqual(['if new.kids <> true then', '    return new;', 'end if;', 'declare']);
    expect(bodyOf(kidsDomain('room.kids_ok == false or booking.kids == true')).slice(0, 3)).toEqual(['if new.kids <> false then', '    return new;', 'end if;']);
  });

  it.each([
    ['and の中の項は門にしない(項だけでは条件が言い切れない)', kidsDomain('booking.kids == false and room.kids_ok == true')],
    ['空にできる欄は門にしない(空のとき <> が通さない)', kidsDomain('booking.kids == false or room.kids_ok == true', false)],
    ['別の集約の欄の項は門にしない', kidsDomain('room.kids_ok == true or room.kids_ok == false')],
  ])('門を作らない: %s', (_title, model) => {
    expect(bodyOf(model)[0]).toBe('declare');
  });
});
