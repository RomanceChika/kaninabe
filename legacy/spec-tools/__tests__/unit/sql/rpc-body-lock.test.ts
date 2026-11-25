/**
 * 定型 RPC の本文が掛ける**行ロック**の生成のユニットテスト(`rpc-body-lock.ts` / `rpc-guard-locks.ts`)。
 *
 * 独立レビューが名指した 2 つの穴を fixture で留める。
 *
 *   - **鎖の途中の行も掴む**: `seat → booking → room` の 2 段のガードで、終点の `rooms` だけで
 *     なく途中の `bookings` も掴む(終点の id は途中の行の参照列を読んで求めるので、途中が
 *     動けば掴んだ行と読んだ行がずれる)。**期待状態の引数は 1 つも無い形**で見る。
 *   - **同じ表の別の行を落とさない**: 2 経路(期待状態の join とガード式のスカラー副問い合わせ)
 *     の畳みは**表ではなく(表, 錨の式)の組**で行う。
 *
 * あわせて、**実行者の行**を掴むこと(0 行の理由を聞き直す文がロールの根拠をそこから読む)と、
 * **掴む順が表名の昇順**であることも見る。
 */

import { TEST_PLATFORM } from '../../helpers/platform.js';
import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { guardLockRows } from '../../../lib/sql/rpc-guard-locks.js';
import type { RpcFactsInput } from '../../../lib/sql/rpc-facts.js';
import type { ReachInput } from '../../../lib/sql/rpc-reach.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, del, entitySpec, field, role, roleSpec, specModel, machine, event } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 席(seat)→ 予約(booking)→ 会議室(room)の 3 段。実行者はメンバー(member)。 */
function domain(): SpecModel {
  return specModel([
    aggregate('seat', {
      entity: entitySpec('seat', {
        label: '席',
        context: { seat: 'seat.id', booking: 'seat.booking_id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('booking_id', { kind: 'ref', entity: 'booking' }, { required: true }),
          field('label', { kind: 'string' }),
        ],
      }),
      // 条件は**終点(room)の欄だけ**を読む。途中の booking の欄は読まない。
      access: accessSpec('seat', {
        creates: [create('member', 'room.state == open')],
        deletes: [del('member', 'room.state == open')],
      }),
    }),
    aggregate('booking', {
      entity: entitySpec('booking', {
        label: '予約',
        context: { booking: 'booking.id', room: 'booking.room_id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }),
        ],
      }),
      stateMachines: [machine('booking', { states: ['held', 'done'], initial: 'held', events: [event('finish', { from: ['held'], to: 'done' })] })],
    }),
    aggregate('room', {
      entity: entitySpec('room', {
        label: '会議室',
        context: { room: 'room.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'room' })],
      }),
      stateMachines: [machine('room', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] })],
    }),
    aggregate('member', {
      entity: entitySpec('member', {
        label: 'メンバー',
        context: { member: 'member.id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('display_name', { kind: 'string' }, { session: true }),
        ],
      }),
    }),
  ]);
}

/** 集約名 → 物理テーブル名。 */
function tableOf(entity: string): string | null {
  const tables: Readonly<Record<string, string>> = {
    seat: 'seats',
    booking: 'bookings',
    room: 'rooms',
    member: 'members',
  };
  return tables[entity] ?? null;
}

/** seats の data_table。 */
function table(): DataTableSpec {
  return dataTable('seats', {
    entity: 'seat',
    resend: { returnsExisting: false, location: { file: 'docs/specs/backend/data/tables/seats.md', pointer: 'resend' } },
  });
}

/** 1 本の定型 RPC を組み立てる(失敗なら理由を文字列にして返す)。`tables` を渡せばトリガ・連鎖の行も掴む。 */
function build(
  name: string,
  shape: 'create' | 'delete',
  params: readonly string[],
  args: readonly string[],
  tables?: readonly DataTableSpec[],
): string {
  const own = tables?.find((candidate) => candidate.table === 'seats') ?? table();
  const result = buildRpcBody({
    name,
    params,
    args,
    shape,
    table: own,
    ...(tables === undefined ? {} : { tables }),
    domain: domain(),
    tableOf,
    actions: undefined,
    specFiles: ['docs/specs/backend/data/tables/seats.md'],
    platform: TEST_PLATFORM,
    entityLabel: '席',
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
}

/** 本文から `for {share|update} of {別名}` が掴む表を、出てくる順に並べる。 */
function lockedTables(sql: string): readonly string[] {
  return [...sql.matchAll(/ {4}perform 1\n {4}from ([^\n]+)\n(?:[^\n]*\n)*? {4}for (?:share|update) of (\w+);/g)].map((match) => {
    const alias = match[2] ?? '';
    const found = new RegExp(`public\\.(\\w+) ${alias}\\b`).exec(match[1] ?? '');
    return found?.[1] ?? '?';
  });
}

/** `guardLockRows` を直に呼ぶための入力(表の引き当てと条件式だけを差し替える)。 */
function lockInput(tables: (entity: string) => string | null, model = domain()): {
  readonly input: RpcFactsInput;
  readonly reach: ReachInput;
} {
  const input = {
    name: 'delete_seat',
    params: ['p_seat_id', 'p_actor_id', 'p_actor_roles'],
    args: ['uuid', 'uuid', 'text[]'],
    shape: 'delete',
    table: table(),
    domain: model,
    tableOf: tables,
    actions: undefined,
  } as RpcFactsInput;
  return {
    input,
    reach: {
      entity: 'seat',
      domain: model,
      tableOf: tables,
      ownColumn: (field) => `t.${field}`,
      ownRefs: new Map([['booking_id', 't.booking_id']]),
    },
  };
}

describe('掴めない相手は黙って落とさない(Finding)', () => {
  it('ガードが読む集約に data_table が無ければ、場所と対処つきで報告する', () => {
    const { input, reach } = lockInput((entity) => (entity === 'room' ? null : `${entity}s`));
    const result = guardLockRows(input, 'seat', reach);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.message).toContain('room');
    expect(result.problems[0]?.suggestion).toContain('data_table');
    expect(result.problems[0]?.counterexample).toMatchObject({ from: 'seat', to: 'room' });
  });

  it('条件式が読めなければ、その式を載せて報告する(掴む相手が黙って減らない)', () => {
    const broken = specModel([
      aggregate('seat', {
        entity: entitySpec('seat', {
          label: '席',
          context: { seat: 'seat.id', booking: 'seat.booking_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('booking_id', { kind: 'ref', entity: 'booking' }, { required: true }),
          ],
        }),
        access: accessSpec('seat', { deletes: [del('member', 'room.state ==')] }),
      }),
    ]);
    const { input, reach } = lockInput((entity) => `${entity}s`, broken);
    const result = guardLockRows(input, 'seat', reach);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('条件式を読めない');
    expect(result.problems[0]?.counterexample).toMatchObject({ guard: 'room.state ==' });
  });
});

describe('行ロックの生成', () => {
  it('期待状態の引数を持たない 2 段のガードでも、鎖の終点と**途中**の行を掴む', () => {
    const sql = build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]']);
    expect(sql).toContain('for share of');
    // 終点(rooms)だけでなく途中(bookings)も掴む。実行者の行(members)と、
    // **これから書く行(seats)** も同じ列に並ぶ。
    expect(lockedTables(sql)).toEqual(['bookings', 'members', 'rooms', 'seats']);
  });

  it('書く行も順序に入る(読む行だけを掴むと、書く表の名前が小さいときに逆順ができる)', () => {
    const sql = build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]']);
    expect(sql).toContain('from public.seats t\n    where t.id = p_seat_id\n    for update of t;');
    // 掴み終えてから書く。
    expect(sql.indexOf('for update of t;')).toBeLessThan(sql.indexOf('delete from public.seats'));
  });

  it('掴む順は表名の昇順で、書き込みはその後に来る', () => {
    const sql = build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]']);
    const tables = lockedTables(sql);
    // バイト順(`localeCompare` ではなく `<`)で単調非減少。
    expect([...tables].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))).toEqual([...tables]);
    expect(sql.indexOf('for share of')).toBeLessThan(sql.indexOf('delete from public.seats'));
  });

  it('鎖の途中の行は、その行の id を与える式で掴む(終点の id をそこから読むため)', () => {
    const sql = build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]']);
    expect(sql).toContain('.id = t.booking_id');
    expect(sql).toContain('.id = (select r1.room_id from public.bookings r1 where r1.id = t.booking_id)');
  });

  it('実行者の行は `by` のロールの根拠なので、書き込みの前に掴む', () => {
    const sql = build('insert_seat', 'create', ['p_id', 'p_booking_id', 'p_values', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]']);
    expect(sql).toContain('from public.members la\n    where la.id = p_actor_id\n    for share of la;');
  });

  it('削除の連鎖が消す行も、表名の昇順の列に入れて書き込みの前に掴む(点検 18 回目 O18-1)', () => {
    // 席を消すと、席を指すメモ(a_seat_notes。名前が seats より小さい)が on delete cascade で消える。
    // 先掴みに入れないと、連鎖の中で seats の後から掴むことになる(表名のバイト順の逆)。
    const seats = dataTable('seats', {
      entity: 'seat',
      functions: [
        {
          name: 'delete_seat',
          args: [],
          params: [],
          kind: 'rpc',
          shape: 'delete',
          alsoWrites: ['domain_events', 'a_seat_notes'],
          alsoWriteKinds: { domain_events: ['insert'], a_seat_notes: ['delete'] },
        } as DataTableSpec['functions'][number],
      ],
    });
    const notes = dataTable('a_seat_notes', { entity: 'seat_note', foreignKeys: [{ column: 'seat_id', references: 'seats', onDelete: 'cascade' }] });
    const sql = build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]'], [seats, notes]);
    expect(lockedTables(sql)).toEqual(['a_seat_notes', 'bookings', 'members', 'rooms', 'seats']);
    expect(sql).toContain('from public.a_seat_notes c0\n    where c0.seat_id = p_seat_id\n    order by c0.id\n    for update of c0;');
    expect(sql.indexOf('for update of c0;')).toBeLessThan(sql.indexOf('delete from public.seats'));
    // 全 data_table を渡さない呼び手(T6 / T14)では掴む行は変わらない。
    expect(lockedTables(build('delete_seat', 'delete', ['p_seat_id', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'text[]']))).toEqual(['bookings', 'members', 'rooms', 'seats']);
  });

  it('同じ表でも錨の式が違えば両方掴む(表だけで畳むと別の行を落とす。両方の選び方を 1 文の和に入れる)', () => {
    // 期待状態の引数(`p_expected_room_state`)が join で rooms を引き当て、ガード式は
    // スカラー副問い合わせで同じ表を読む —— 錨の字面が違うので 2 つの行を掴む。同じ表は 1 文に畳む(点検 fix26 6 回目 D26f-1)ので、
    // 1 文の id の和の中に両方の選び方が残る。
    const sql = build(
      'insert_seat',
      'create',
      ['p_id', 'p_booking_id', 'p_expected_room_state', 'p_values', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'uuid', 'text', 'jsonb', 'uuid', 'text[]'],
    );
    expect(lockedTables(sql).filter((name) => name === 'rooms').length).toBe(1);
    const merged = /\n {4}from public\.rooms lm0\n {4}where lm0\.id in \(([^\n]+)\)\n/u.exec(sql)?.[1] ?? '';
    expect(merged.split(' union ')).toHaveLength(2);
  });

  it('トリガが親を排他で掴むと宣言すれば、同じ行の共有の掴みを排他に強めて 1 回だけ掴む(点検 19 回目 A19-1・作成も O19-3)', () => {
    const seats: DataTableSpec = {
      ...table(),
      foreignKeys: [{ column: 'booking_id', references: 'bookings', onDelete: 'cascade' }],
      triggers: [{ name: 'check_seat', functionName: 'check_seat', fires: 'before insert', deferred: false, supplies: [], params: {}, locks: { bookings: 'update' } } as DataTableSpec['triggers'][number]],
    };
    const params = ['p_id', 'p_booking_id', 'p_values', 'p_actor_id', 'p_actor_roles'];
    const args = ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]'];
    const plain = build('insert_seat', 'create', params, args);
    const locked = build('insert_seat', 'create', params, args, [seats]);
    expect(lockedTables(locked)).toEqual(lockedTables(plain));
    const bookings = /from public\.bookings (\w+)\n[^;]*for (share|update) of \1;/.exec(locked);
    expect(bookings?.[2]).toBe('update');
    expect(/from public\.bookings (\w+)\n[^;]*for share of \1;/.test(plain)).toBe(true);
  });
});


describe('作る表が実行者の表と同じ作成(点検 26 回目 D26-1)', () => {
  /** 実行者の集約 staff を、管理者(staff の claim)が作る —— 作る表 = 実行者の表。 */
  function staffSql(): string {
    const model = specModel(
      [
        aggregate('staff', {
          entity: entitySpec('staff', {
            fields: [
              field('id', { kind: 'uuid' }),
              field('name', { kind: 'string' }, { required: true, session: true }),
              field('is_admin', { kind: 'boolean' }, { session: true }),
            ],
          }),
          access: accessSpec('staff', { creates: [create('admin')] }),
        }),
      ],
      roleSpec([role('member'), role('anonymous'), role('system'), { ...role('admin', undefined, ['member']), claim: 'staff.is_admin' }]),
    );
    const insert = { name: 'insert_staff', args: ['uuid', 'jsonb', 'uuid', 'text[]'], params: ['p_id', 'p_values', 'p_actor_id', 'p_actor_roles'], kind: 'rpc', shape: 'create', alsoWrites: [] } as const;
    const result = buildRpcBody({
      name: insert.name,
      params: insert.params,
      args: insert.args,
      shape: 'create',
      table: dataTable('staffs', { entity: 'staff', resend: { returnsExisting: true, location: { file: 'x.md', pointer: 'resend' } }, functions: [insert as DataTableSpec['functions'][number]] }),
      domain: model,
      tableOf: (entity) => (entity === 'staff' ? 'staffs' : null),
      actions: { actions: [actionSpec({ handles: 'staff.create', input: ['staff.name'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      specFiles: ['x.md'],
      entityLabel: '従業員',
      platform: TEST_PLATFORM,
    });
    return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
  }

  it('実行者の行と冪等キーの行を 1 文で id の昇順に共有で掴み(排他は外部キーの確かめと輪になる。D26b-1)、その後に挿入の前の再送の枝を見る', () => {
    const sql = staffSql();
    const lock = sql.indexOf('    perform 1\n    from public.staffs la\n    where la.id in (p_actor_id, p_id)\n    order by la.id\n    for share of la;');
    const resend = sql.indexOf('    if exists (select 1 from public.staffs where id = p_id) then');
    expect(lock).toBeGreaterThan(-1);
    expect(resend).toBeGreaterThan(lock);
    expect(sql.indexOf('    insert into public.staffs (')).toBeGreaterThan(resend);
    // 実行者の行だけを共有で掴む 1 文(冪等キーの行を掴まない形)は残さない。
    expect(sql).not.toContain('where la.id = p_actor_id\n    for share of la;');
    expect(lockedTables(sql)).toEqual(['staffs']);
  });
});
