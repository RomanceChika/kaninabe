/**
 * 定型 RPC の本文の生成(5 形のうち composite 以外の 4 つ)のユニットテスト。
 *
 * 見るのは「宣言のどこが本文のどこに出るか」である(束 ⑳-2)。
 *   - 作成: 入れる列 = `p_id` + 引数の列 + `p_values` の欄 / ガードは参照の鎖 / 冪等の再送
 *   - 編集: 許可列の閉じた集合 = access_spec の `writes` の和 / 効果の門 = `writes[].effects`
 *   - 削除: 楽観的並行制御と監査ログだけ
 *   - 遷移: 状態列 + `clears` が決める空の扱い
 *   - **throw しない**: 規約から決まらない引数は理由つきの `problems` で返る
 */

import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_PLATFORM } from '../../helpers/platform.js';
import type { PlatformProfile } from '../../../lib/model/product/platform-profile.js';
import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, del, entitySpec, event, field, machine, specModel, write } from '../../helpers/model-builder.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 予約(booking)1 集約だけのドメイン。会議室(room)を親に持つ。 */
function domain(): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        label: '予約',
        // 他集約へ届く道は `context:` の宣言が正である(ref-path.ts)。
        context: { booking: 'booking.id', room: 'booking.room_id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }),
          field('purpose', { kind: 'string' }),
          field('note', { kind: 'text' }, { personal: true, personalPlaceholder: null }),
          field('seats', { kind: 'integer' }),
        ],
      }),
      access: accessSpec('booking', {
        creates: [create('member', 'room.state == open')],
        writes: [write('member', ['purpose', 'note'])],
        deletes: [del('member', 'state == held')],
      }),
      stateMachines: [
        machine('booking', {
          states: ['held', 'done'],
          initial: 'held',
          events: [event('finish', { from: ['held'], to: 'done', by: ['member'], guard: 'room.state == open' })],
        }),
      ],
    }),
    aggregate('room', {
      entity: entitySpec('room', {
        label: '会議室',
        context: { room: 'room.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'room' })],
      }),
      stateMachines: [machine('room', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] })],
    }),
  ]);
}

/** `booking.create` が purpose / note / seats を入力に取る action_spec。 */
function actions(): ActionSpecModel {
  return {
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
    actions: ['create', 'update'].map((verb) => ({
      id: `booking-${verb}-action`,
      handles: { raw: `booking.${verb}`, machine: 'booking', event: verb },
      input: ['purpose', 'note', 'seats'].map((name) => ({ raw: `booking.${name}`, entity: 'booking', field: name })),
      errors: { inherits: 'common', additional: [] },
      computes: [],
      testCases: [],
      location: { file: `docs/specs/backend/actions/booking/${verb}.md` },
      relPath: `booking/${verb}.md`,
    })) as unknown as ActionSpecModel['actions'],
  };
}

/** bookings の data_table(既定値を 1 つ持たせて `coalesce` の枝も踏む)。 */
function table(): DataTableSpec {
  // 予約には実行者を指す欄が無いので、再送で既存の行を返さない宣言(返す形は rpc-resend.test.ts が見る)。
  return dataTable('bookings', {
    entity: 'booking',
    defaults: { seats: '0' },
    resend: { returnsExisting: false, location: { file: 'docs/specs/backend/data/tables/bookings.md', pointer: 'resend' } },
  });
}

/** 1 本の定型 RPC を組み立てる(失敗なら理由を文字列にして返す)。 */
function build(
  name: string,
  shape: 'create' | 'update' | 'delete' | 'transition',
  params: readonly string[],
  args: readonly string[],
  platform: PlatformProfile = TEST_PLATFORM,
  model: SpecModel = domain(),
): string {
  const result = buildRpcBody({
    name,
    params,
    args,
    shape,
    table: table(),
    domain: model,
    tableOf: (entity) => (entity === 'room' ? 'rooms' : entity === 'booking' ? 'bookings' : null),
    actions: actions(),
    specFiles: ['docs/specs/backend/data/tables/bookings.md'],
    entityLabel: '予約',
    platform,
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
}

describe('定型 RPC の本文の生成', () => {
  it('作成: 入れる列は p_id + 引数の列 + p_values の欄、既定値のある列は coalesce で受ける', () => {
    const sql = build('insert_booking', 'create', ['p_id', 'p_room_id', 'p_values', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]']);
    expect(sql).toContain('insert into public.bookings (\n        id, room_id, purpose, note, seats\n    )');
    expect(sql).toContain("coalesce((p_values ->> 'seats')::integer, 0)");
    expect(sql).toContain('on conflict (id) do nothing');
    expect(sql).toContain('if exists (select 1 from public.bookings where id = p_id) then');
  });

  it('作成: 1 欄ずつ受ける引数も jsonb の袋と同じ写像を通る(型が違えば cast が付く)', () => {
    const sql = build(
      'insert_booking',
      'create',
      ['p_id', 'p_room_id', 'p_seats', 'p_values', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'uuid', 'text', 'jsonb', 'uuid', 'text[]'],
    );
    expect(sql).toContain('(p_seats)::integer');
  });

  it('作成: 宣言した型が列の型と同じ引数には cast を足さない(字面が伸びるだけ)', () => {
    const sql = build(
      'insert_booking',
      'create',
      ['p_id', 'p_room_id', 'p_seats', 'p_values', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'uuid', 'integer', 'jsonb', 'uuid', 'text[]'],
    );
    expect(sql).not.toContain('::integer');
    expect(sql).toContain('id, room_id, seats, purpose, note');
  });

  it('遷移: 状態のほかに書く列も同じ写像を通る', () => {
    const sql = build(
      'apply_booking_transition',
      'transition',
      ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_seats', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'text', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
    );
    expect(sql).toContain('coalesce((p_seats)::integer, t.seats)');
  });

  it('作成: 個人の欄は監査ログに値を載せず、列名だけ redacted に残る', () => {
    const sql = build('insert_booking', 'create', ['p_id', 'p_room_id', 'p_values', 'p_actor_id', 'p_actor_roles'], ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]']);
    expect(sql).toContain("(p_values - array['note']::text[])");
    expect(sql).toContain("jsonb_build_object('redacted', (");
  });

  it('作成: 親の状態を条件にする引数は参照の鎖になる', () => {
    const sql = build(
      'insert_booking',
      'create',
      ['p_id', 'p_room_id', 'p_expected_room_state', 'p_values', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'uuid', 'text', 'jsonb', 'uuid', 'text[]'],
    );
    expect(sql).toContain('where exists (');
    expect(sql).toContain('from public.rooms g0');
    expect(sql).toContain('g0.id = p_room_id');
    expect(sql).toContain('g0.state = p_expected_room_state');
  });

  it('編集: 許可列の閉じた集合と SET 句は access_spec の writes の和である', () => {
    const sql = build('update_booking', 'update', ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'], ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]']);
    expect(sql).toContain("where key not in ('purpose', 'note');");
    expect(sql).toContain("purpose = case when p_changes ? 'purpose' then p_changes ->> 'purpose' else t.purpose end");
    expect(sql).toContain('t.state = p_expected_state');
    // 効果の門を宣言していない集約は、ループを条件で包まない。
    expect(sql).not.toContain('v_before_');
  });

  it('編集: 遷移だけが書く列(transition_writes)は編集の RPC に経路を作らない(対照: writes の by: system の行は作る)', () => {
    const withAccess = (access: ReturnType<typeof accessSpec>): SpecModel => {
      const base = domain();
      const booking = base.aggregates.get('booking');
      const aggregates = new Map(base.aggregates);
      if (booking !== undefined) aggregates.set('booking', { ...booking, access });
      return { ...base, aggregates };
    };
    const params = ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'];
    const args = ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]'];
    const human = write('member', ['purpose', 'note']);

    const transitionOnly = build('update_booking', 'update', params, args, TEST_PLATFORM, withAccess(accessSpec('booking', { writes: [human], transitionWrites: ['seats'] })));
    expect(transitionOnly).toContain("where key not in ('purpose', 'note');");
    expect(transitionOnly).not.toContain("p_changes ? 'seats'");
    expect(transitionOnly).not.toContain('seats = case');

    const systemRow = build('update_booking', 'update', params, args, TEST_PLATFORM, withAccess(accessSpec('booking', { writes: [human, write('system', ['seats'])] })));
    expect(systemRow).toContain("where key not in ('purpose', 'note', 'seats');");
    expect(systemRow).toContain("p_changes ? 'seats'");
  });

  it('削除: 楽観的並行制御と監査ログだけを持つ', () => {
    const sql = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'], ['uuid', 'text', 'uuid', 'text[]']);
    expect(sql).toContain('delete from public.bookings t');
    expect(sql).toContain("values ('booking.delete', 'booking', p_booking_id, p_actor_id);");
    expect(sql).not.toContain('jobs');
  });

  it('遷移: 状態列を動かし、副作用を outbox に積む', () => {
    const sql = build(
      'apply_booking_transition',
      'transition',
      ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
    );
    expect(sql).toContain('set\n        state = p_next_state');
    expect(sql).toContain('insert into public.jobs (id, type, payload, idempotency_key)');
    expect(sql).toContain("jsonb_build_object('booking_id', p_booking_id)");
  });

  it('権限は service_role だけに与えられる', () => {
    const sql = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'], ['uuid', 'text', 'uuid', 'text[]']);
    expect(sql).toContain('revoke all on function api.delete_booking(uuid, text, uuid, text[]) from public;');
    expect(sql).toContain('grant execute on function api.delete_booking(uuid, text, uuid, text[]) to service_role;');
  });

  it('by(ロール)とガードが本文の where に入る(束 ⑳-3)', () => {
    const sql = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'], ['uuid', 'text', 'uuid', 'text[]']);
    // グローバルロールは実行者が渡すロール配列に入っているかだけを見る。
    expect(sql).toContain("coalesce('member' = any(p_actor_roles), false)");
    // 自集約の欄を条件にするガードは、対象の行の列に落ちる。
    expect(sql).toContain("(t.state) = 'held'");
  });

  it('他集約の欄を条件にするガードは、参照の鎖をスカラー副問い合わせで辿る(束 ⑳-3)', () => {
    const sql = build(
      'apply_booking_transition',
      'transition',
      ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
    );
    expect(sql).toContain('select r1.state from public.rooms r1 where r1.id = t.room_id');
    // 遷移は(イベント × 遷移元)で分岐し、宣言に無い組は落とす。
    expect(sql).toContain("when p_event_id = 'booking.finish' and p_expected_state = 'held'");
    expect(sql).toContain('else false');
  });

  it('0 行の理由を errcode で分類する(状態 → ロール → ガードの順。束 ⑳-3)', () => {
    // 順は engine の写しである —— `canFire` は `invalid_from` を `role_forbidden` より先に返す。
    const sql = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'], ['uuid', 'text', 'uuid', 'text[]']);
    const conflict = sql.indexOf("errcode = 'UC409'");
    const forbidden = sql.indexOf("errcode = 'UC403'", conflict);
    const guard = sql.indexOf("errcode = 'UC412'", forbidden);
    expect(conflict).toBeGreaterThan(-1);
    expect(forbidden).toBeGreaterThan(conflict);
    expect(guard).toBeGreaterThan(forbidden);
  });

  it('照会が 3 つとも通った 0 行は競合である(分類は 2 段。束 ⑳-3b)', () => {
    const sql = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'], ['uuid', 'text', 'uuid', 'text[]']);
    // ガードの段は `if` で囲われており、無条件の raise ではない。
    expect(sql).toContain("if not v_guard_ok then\n            raise exception using errcode = 'UC412'");
    // 受けた変数は読まれる(宣言しただけの死んだ変数を作らない)。
    expect(sql).toContain('into v_role_ok, v_guard_ok');
    expect(sql).toContain('if not v_role_ok then');
    // 最後は競合。ガードの raise より後ろに UC409 がもう 1 つある。
    const guard = sql.indexOf("errcode = 'UC412'");
    expect(sql.indexOf("errcode = 'UC409'", guard)).toBeGreaterThan(guard);
  });

  it('成立しうるガードが無い形は、ガードの段そのものを持たない(束 ⑳-3b)', () => {
    // booking の `writes` は条件を持たない —— この関数に「ガード違反」という結末は存在しない。
    const sql = build('update_booking', 'update', ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'], ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]']);
    // 本文が「ガード違反」を raise する箇所は 1 つも無い(`comment on function` は語彙の説明なので別)。
    expect(sql).not.toContain("errcode = 'UC412'");
    expect(sql).not.toContain('v_guard_ok');
    // 状態 → ロール で尽き、残りは競合である。
    const forbidden = sql.indexOf("errcode = 'UC403'", sql.indexOf('on conflict (id) do nothing'));
    expect(forbidden).toBeGreaterThan(-1);
    expect(sql.indexOf("errcode = 'UC409'", forbidden)).toBeGreaterThan(forbidden);
  });

  it('作成は by を見てから再送(冪等)を見る(束 ⑳-3b)', () => {
    const sql = build(
      'insert_booking',
      'create',
      ['p_id', 'p_room_id', 'p_expected_room_state', 'p_values', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'uuid', 'text', 'jsonb', 'uuid', 'text[]'],
    );
    // 挿入の後ろの 0 行の分類の中の再送の枝(挿入の前の同じ枝は rpc-resend.test.ts が見る。点検 26 回目 B26-1)。
    const resend = sql.indexOf('if exists (select 1 from public.bookings where id = p_id) then', sql.indexOf('on conflict (id) do nothing'));
    expect(resend).toBeGreaterThan(-1);
    // 再送で既存の行を返さない表なので、同じ id の行があれば**その枝の中で**競合にする(後ろの段へ落とさない)。
    const conflict = sql.indexOf("errcode = 'UC409'", resend);
    expect(conflict).toBeGreaterThan(resend);
    expect(sql.slice(resend, conflict)).not.toContain('return next');
    // **ロールの段は再送より前**(権限の無い実行者には、既存の id を渡されても行を返さない)。
    const forbidden = sql.indexOf("errcode = 'UC403'");
    expect(forbidden).toBeGreaterThan(-1);
    expect(forbidden).toBeLessThan(resend);
    // ガードの段は再送より後ろ(同じ id の衝突はガードの具合に依らず競合になる)。
    expect(sql.indexOf("errcode = 'UC412'")).toBeGreaterThan(conflict);
    // 作成のガードは引数から辿る(対象の行がまだ無い)。
    expect(sql).toContain('select r1.state from public.rooms r1 where r1.id = p_room_id');
  });

  it('グローバルロールを見るのに p_actor_roles が無ければ理由つきで返る(束 ⑳-3)', () => {
    const problems = build('delete_booking', 'delete', ['p_booking_id', 'p_expected_state', 'p_actor_id'], ['uuid', 'text', 'uuid']);
    expect(problems).toContain('delete_booking は by にグローバルロールを持ちますが引数 p_actor_roles がありません');
  });

  it('規約から決まらない引数は throw ではなく理由つきで返る', () => {
    const problems = build('delete_booking', 'delete', ['p_booking_id', 'p_whatever'], ['uuid', 'text']);
    expect(problems).toContain('delete_booking の引数 p_whatever の役目が規約から決まりません');
  });

  it('辿れない集約を条件にする引数は throw ではなく理由つきで返る', () => {
    const problems = build(
      'delete_booking',
      'delete',
      ['p_booking_id', 'p_expected_booking_state', 'p_actor_id', 'p_actor_roles'],
      ['uuid', 'text', 'uuid', 'text[]'],
    );
    expect(problems).toContain('delete_booking の引数 p_expected_booking_state が条件にする booking まで参照が辿れません');
  });
});

describe('別のプラットフォームの設定を渡すと(RPC の置き場と実行ロールは設定から引く)', () => {
  const params = ['p_id', 'p_room_id', 'p_values', 'p_actor_id', 'p_actor_roles'];
  const args = ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]'];

  it('関数の置き場・旧署名を落とす対象のスキーマ・実行を許す唯一のロールが設定の名前になる', () => {
    const sql = build('insert_booking', 'create', params, args, FOREIGN_PLATFORM);
    expect(sql).toContain('create or replace function edge.insert_booking(');
    expect(sql).toContain("where n.nspname = 'edge'");
    expect(sql).toContain('revoke all on function edge.insert_booking(uuid, uuid, jsonb, uuid, text[]) from public;');
    expect(sql).toContain('grant execute on function edge.insert_booking(uuid, uuid, jsonb, uuid, text[]) to worker;');
  });

  it('Supabase の綴りが 1 つも残らない', () => {
    expect(leaksSupabaseSpelling(build('insert_booking', 'create', params, args, FOREIGN_PLATFORM))).toBe(false);
    expect(leaksSupabaseSpelling(build('insert_booking', 'create', params, args))).toBe(true);
  });
});

