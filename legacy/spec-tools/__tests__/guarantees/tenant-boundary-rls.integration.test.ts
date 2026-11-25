/**
 * テナント境界(`reads[].filters`)の**生成した RLS** を実 DB に当てて、筋書きどおりの行集合が返ることの
 * 統合テスト(実 DB)。
 *
 * 仕様: docs/rules/process/common/specification/standards/domain-spec-writing.md §access_spec(filters)
 *       生成器: legacy/spec-tools/lib/sql/rls-predicate.ts / rls-migration.ts(`buildBoundaryHelperMigration`)
 *
 * 2 つの筋書きを固定する。
 *
 * 1. **親の列で書いた境界**(予約 → 部屋 → 部門。部門だけが会社の列を持つ)は、生成した RLS で他社の
 *    予約を返さない。予約は会社の列を持たないので、以前は境界を書く語彙が無かった。
 * 2. **写しが古いトークン**(運営が利用者の所属を付け替えた直後。トークンには前の会社が残っている)でも、
 *    付け替えたあとは前の会社の行を読めない。境界の右辺は実行者自身の行から読む補助関数
 *    (`public.actor_{欄}()`)であり、トークンの属性(`app_metadata.profile`)を信じない。
 *
 * 表も関数も**このテストだけの名前**で 1 トランザクションの中に作り、最後に rollback する(製品の表を
 * 1 つも使わない。`guard-sql-parity` と同じ構え)。SQL は仕様のリテラルから生成器を呼んで組み立てる ——
 * 手で書いたポリシーを確かめても、生成器の正しさは何も言えない。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBoundaryHelperMigration, buildHelperMigration, buildPolicyMigration } from '../../lib/sql/rls-migration.js';
import { policyPlans } from '../../lib/world/index.js';
import type { RoleDef, SpecModel } from '../../lib/model/types.js';
import { TEST_PLATFORM } from '../helpers/platform.js';
import { accessSpec, aggregate, entitySpec, field, read, role, roleSpec, specModel } from '../helpers/model-builder.js';

/** 境界の欄(製品の関数と名前が重ならない綴り)。 */
// 境界の欄の名前。ポリシー名({表}_select_{ロール}_{スコープ}_within_{集約}_{列})が PostgreSQL の識別子の上限(63 バイト)に収まる長さにする
// (長い欄名だと名前が 67〜70 バイトになり、DB が黙って切り詰める —— 生成器はそれを止める)。
const TENANT = 'org_id';

/** ロール(既定のログインロールの名前も、製品の補助関数 `is_*` と重ならない綴りにする)。 */
const ROLES: readonly RoleDef[] = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('tbr_member', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
]).roles;

/** 集約 → 物理テーブル名。 */
const TABLES: Readonly<Record<string, string>> = {
  tbr_member: 'tbr_members',
  tbr_department: 'tbr_departments',
  tbr_room: 'tbr_rooms',
  tbr_booking: 'tbr_bookings',
};

/** 境界の読み取り 1 本(既定のログインロールが全件を、境界で狭めて読む)。 */
function bounded(left: string): ReturnType<typeof read> {
  return read('tbr_member', 'all', { [left]: TENANT });
}

/** 仕様のリテラル(予約 → 部屋 → 部門。会社の列は部門と利用者だけが持つ)。 */
function domain(): SpecModel {
  return specModel(
    [
      aggregate('tbr_member', {
        entity: entitySpec('tbr_member', {
          context: { tbr_member: 'tbr_member.id' },
          fields: [field('id', { kind: 'uuid' }), field(TENANT, { kind: 'uuid' }, { required: true, session: true })],
        }),
        access: accessSpec('tbr_member', { reads: [bounded(TENANT)] }),
      }),
      aggregate('tbr_department', {
        entity: entitySpec('tbr_department', {
          context: { tbr_department: 'tbr_department.id' },
          fields: [field('id', { kind: 'uuid' }), field(TENANT, { kind: 'uuid' }, { required: true })],
        }),
        access: accessSpec('tbr_department', { reads: [bounded(TENANT)] }),
      }),
      aggregate('tbr_room', {
        entity: entitySpec('tbr_room', {
          context: { tbr_department: 'tbr_room.department_id' },
          fields: [field('id', { kind: 'uuid' }), field('department_id', { kind: 'ref', entity: 'tbr_department' }, { required: true })],
        }),
        access: accessSpec('tbr_room', { reads: [bounded(`tbr_department.${TENANT}`)] }),
      }),
      aggregate('tbr_booking', {
        entity: entitySpec('tbr_booking', {
          context: { tbr_booking: 'tbr_booking.id', tbr_room: 'tbr_booking.room_id' },
          fields: [field('id', { kind: 'uuid' }), field('room_id', { kind: 'ref', entity: 'tbr_room' }, { required: true })],
        }),
        // 2 段先(予約 → 部屋 → 部門)の列で書いた境界。
        access: accessSpec('tbr_booking', { reads: [bounded(`tbr_department.${TENANT}`)] }),
      }),
    ],
    roleSpec([...ROLES]),
  );
}

/** 生成器が返した SQL(組み立てられなければテストの前提が壊れている)。 */
function sqlOf(result: { readonly ok: true; readonly sql: string } | { readonly ok: false; readonly problems: readonly { readonly message: string }[] }): string {
  if (result.ok) return result.sql;
  throw new Error(`生成器が SQL を組み立てられません: ${result.problems.map((problem) => problem.message).join(' / ')}`);
}

/** 表(最小の DDL。列の正は上の仕様のリテラル)と、生成した補助関数・ポリシー。 */
function schemaSql(model: SpecModel): readonly string[] {
  const tableOf = (entity: string): string | null => TABLES[entity] ?? null;
  const ddl = [
    `create table public.tbr_members (id uuid primary key, ${TENANT} uuid not null)`,
    `create table public.tbr_departments (id uuid primary key, ${TENANT} uuid not null)`,
    'create table public.tbr_rooms (id uuid primary key, department_id uuid not null references public.tbr_departments (id))',
    'create table public.tbr_bookings (id uuid primary key, room_id uuid not null references public.tbr_rooms (id))',
  ];
  const memberRole = ROLES.find((candidate) => candidate.id === 'tbr_member');
  if (memberRole === undefined) throw new Error('題材のロールが壊れています');
  const helpers = [
    sqlOf(buildHelperMigration({ role: memberRole, domain: model, tableOf, specFiles: [], platform: TEST_PLATFORM })),
    sqlOf(buildBoundaryHelperMigration({ field: TENANT, domain: model, tableOf, specFiles: [], platform: TEST_PLATFORM })),
  ];
  const policies = Object.entries(TABLES).map(([entity, table]) => {
    const access = model.aggregates.get(entity)?.access;
    if (access === undefined) throw new Error(`題材の ${entity} に access_spec がありません`);
    return sqlOf(
      buildPolicyMigration({
        plans: policyPlans(access, table, ROLES),
        entity,
        table,
        domain: model,
        tableOf,
        roles: ROLES,
        platform: TEST_PLATFORM,
        specFiles: [],
      }),
    );
  });
  return [...ddl, ...helpers, ...policies];
}

/** 会社 2 つ・利用者 2 人・部門 / 部屋 / 予約を会社ごとに 1 つずつ。 */
const IDS = {
  orgA: '00000000-0000-4000-8000-00000000000a',
  orgB: '00000000-0000-4000-8000-00000000000b',
  memberA: '00000000-0000-4000-8000-0000000000a1',
  memberB: '00000000-0000-4000-8000-0000000000b1',
  departmentA: '00000000-0000-4000-8000-0000000000a2',
  departmentB: '00000000-0000-4000-8000-0000000000b2',
  roomA: '00000000-0000-4000-8000-0000000000a3',
  roomB: '00000000-0000-4000-8000-0000000000b3',
  bookingA: '00000000-0000-4000-8000-0000000000a4',
  bookingB: '00000000-0000-4000-8000-0000000000b4',
  // 利用者それぞれのログインセッション(全ての表の制限ポリシーはセッションの生死を要求する)。
  sessionA: '00000000-0000-4000-8000-0000000000a5',
  sessionB: '00000000-0000-4000-8000-0000000000b5',
} as const;

/** 行を置く(所有者 = 接続のロールで。RLS は所有者に掛からない)。 */
async function seed(connection: Client): Promise<void> {
  await connection.query(`insert into public.tbr_members values ($1, $2), ($3, $4)`, [IDS.memberA, IDS.orgA, IDS.memberB, IDS.orgB]);
  await connection.query(`insert into public.tbr_departments values ($1, $2), ($3, $4)`, [IDS.departmentA, IDS.orgA, IDS.departmentB, IDS.orgB]);
  await connection.query('insert into public.tbr_rooms values ($1, $2), ($3, $4)', [IDS.roomA, IDS.departmentA, IDS.roomB, IDS.departmentB]);
  await connection.query('insert into public.tbr_bookings values ($1, $2), ($3, $4)', [IDS.bookingA, IDS.roomA, IDS.bookingB, IDS.roomB]);
  // 認証基盤の利用者とセッション(判定が見るのはセッションの行の実在と期限だけ。この 1 トランザクションで戻す)。
  await connection.query('insert into auth.users (id) values ($1), ($2)', [IDS.memberA, IDS.memberB]);
  await connection.query('insert into auth.sessions (id, user_id) values ($1, $2), ($3, $4)', [IDS.sessionA, IDS.memberA, IDS.sessionB, IDS.memberB]);
}

/**
 * ログインした利用者として 1 つの表を読む(PostgREST と同じ形: ロールを切り替え、JWT の請求をセッションの設定に置く)。
 *
 * `profile` は**トークンに載っている写し**である。境界の判定が写しを読めば、写しの会社の行が返る。
 */
async function readAs(
  connection: Client,
  actor: { readonly id: string; readonly profileOrg: string },
  table: string,
): Promise<readonly string[]> {
  const sessionId = actor.id === IDS.memberA ? IDS.sessionA : IDS.sessionB;
  const claims = { sub: actor.id, role: 'authenticated', session_id: sessionId, app_metadata: { profile: { [TENANT]: actor.profileOrg } } };
  await connection.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await connection.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor.id]);
  await connection.query('set local role authenticated');
  try {
    const result = await connection.query<{ id: string }>(`select id from public.${table} order by id`);
    return result.rows.map((row) => row.id);
  } finally {
    await connection.query('reset role');
  }
}

/** 1 トランザクションの中で題材を作り、本体を実行し、必ず rollback する。 */
async function inScratch(connection: Client, body: () => Promise<void>): Promise<void> {
  await connection.query('begin');
  try {
    for (const statement of schemaSql(domain())) await connection.query(statement);
    await seed(connection);
    await body();
  } finally {
    await connection.query('rollback');
  }
}

let client: Client;

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('環境変数 SUPABASE_DB_URL が設定されていません(@kaninabe/runtime/testing/local/local-supabase.mts)。');
  }
  client = new Client({ connectionString });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe('テナント境界の生成 RLS(実 DB)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-TENANTRLS-001
  it('親の集約の列で書いた境界は、生成した RLS で他社の行を返さない', async () => {
    await inScratch(client, async () => {
      const a = { id: IDS.memberA, profileOrg: IDS.orgA };
      const b = { id: IDS.memberB, profileOrg: IDS.orgB };
      // 2 段先(予約 → 部屋 → 部門)と 1 段先(部屋 → 部門)のどちらの子表も、自社の行だけを返す。
      expect(await readAs(client, a, 'tbr_bookings')).toEqual([IDS.bookingA]);
      expect(await readAs(client, b, 'tbr_bookings')).toEqual([IDS.bookingB]);
      expect(await readAs(client, a, 'tbr_rooms')).toEqual([IDS.roomA]);
      // 実行者の集約そのものに境界を書いた表も、補助関数が所有者の権限で読むので再帰しない。
      expect(await readAs(client, a, 'tbr_members')).toEqual([IDS.memberA]);
    });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-TENANTRLS-002
  it('実行者の所属を付け替えたあとは、写しが古いトークンでも元の会社の行を読めない', async () => {
    await inScratch(client, async () => {
      // 運営が利用者 a を会社 A から B へ移す。手元のトークンの写しは A のまま(最長でトークンの寿命だけ残る)。
      await client.query(`update public.tbr_members set ${TENANT} = $1 where id = $2`, [IDS.orgB, IDS.memberA]);
      const stale = { id: IDS.memberA, profileOrg: IDS.orgA };
      expect(await readAs(client, stale, 'tbr_bookings')).toEqual([IDS.bookingB]);
      expect(await readAs(client, stale, 'tbr_departments')).toEqual([IDS.departmentB]);
    });
  });
});
