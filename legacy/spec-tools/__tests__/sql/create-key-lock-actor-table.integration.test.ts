/**
 * **作る表が実行者の表と同じ作成 RPC** でも、冪等キー `p_id` の既にある行を挿入の前の再送の枝より先に掴む(作成は共有で。D26b-1)ことの統合テスト(実 DB。点検 26 回目 D26-1)。
 *
 * 生成器: legacy/spec-tools/lib/sql/rpc-body-lock.ts(`actorTargets` が実行者の行と冪等キーの行を `la.id in (p_actor_id, p_id)` の 1 文で掴む)
 *
 * 交錯(点検 23 回目 A23-1 の形): 1 回目の作成が書けた後、その行を消す txn がまだコミットしていない間に、同じ鍵の押し直しが来る。
 * 掴まずに枝で実在を見ると、消える前の行を「再送で書けた」と返し、消す側のコミットの後には行が無い(書けたと偽る)。掴めば押し直しは
 * 消す側のコミットを待ち、行が無いのを見て挿入へ進み、作り直しの断り(`resend_target_deleted`)に合流する。
 *
 * もう 1 つの交錯(点検 fix26 2 回目 D26b-1): 作成の挿入は外部キーの確かめで親(`xk_shops`)の行を `for key share` で掴む。実行者の行を排他で
 * 掴んだまま挿入へ進むと、親を排他で掴んでから実行者の行を共有で掴む別の txn と 40P01 の輪になる。実行者の行と冪等キーの行は共有で掴む
 * (共有は消す txn の排他と衝突するので、上の待ちは保つ)。
 *
 * 表も関数も**このテストだけの名前**(`xk_` 接頭辞)で作り、最後に消す。SQL は仕様のリテラルから生成器を呼んで組み立てる。監査ログの表の
 * 名前だけは生成器が固定の字面で書くので、このテストの表へ機械的に付け替える(掴みと枝の字面は触らない)。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../lib/sql/rpc-body.js';
import type { DataTableSpec } from '../../lib/model/data/types.js';
import { TEST_PLATFORM } from '../helpers/platform.js';
import { dataTable } from '../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel } from '../helpers/model-builder.js';
import { actionSpec } from '../helpers/trace-builder.js';

/** 物理テーブル名・関数名(製品の名前と重ならない綴り)。 */
const STAFFS = 'xk_staffs';
const SHOPS = 'xk_shops';
const EVENTS = 'xk_domain_events';
const FN = 'xk_insert_staff';

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const ROW_ID = '00000000-0000-4000-8000-0000000000d1';
const RING_ID = '00000000-0000-4000-8000-0000000000d2';
const SHOP = '00000000-0000-4000-8000-0000000000b1';

/** 実行者の集約 staff を、管理者(staff の claim)が作る —— 作る表 = 実行者の表。 */
function generatedSql(): string {
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
  const insert = { name: FN, args: ['uuid', 'jsonb', 'uuid', 'text[]'], params: ['p_id', 'p_values', 'p_actor_id', 'p_actor_roles'], kind: 'rpc', shape: 'create', alsoWrites: [] } as const;
  const result = buildRpcBody({
    name: FN,
    params: insert.params,
    args: insert.args,
    shape: 'create',
    table: dataTable(STAFFS, { entity: 'staff', resend: { returnsExisting: true, location: { file: 'x.md', pointer: 'resend' } }, functions: [insert as DataTableSpec['functions'][number]] }),
    domain: model,
    tableOf: (entity) => (entity === 'staff' ? STAFFS : null),
    actions: { actions: [actionSpec({ handles: 'staff.create', input: ['staff.name'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
    specFiles: ['x.md'],
    entityLabel: '従業員',
    platform: TEST_PLATFORM,
  });
  if (!result.ok) throw new Error(`生成器が本文を出せません: ${result.problems.map((problem) => problem.message).join(' / ')}`);
  return result.sql.replaceAll('public.domain_events', `public.${EVENTS}`);
}

let client: Client;
let other: Client;

/** pg のエラーの形。 */
interface PgFailure {
  readonly detail?: string;
  readonly message: string;
}

/** 作成を呼ぶ(返った行の id と、再送の印)。 */
async function insertStaff(c: Client, id = ROW_ID): Promise<{ readonly id: string; readonly resent: string | null }> {
  const { rows } = await c.query<{ id: string; resent: string | null }>(
    `select id, current_setting('st.resent_id', true) as resent from api.${FN}($1, $2, $3, '{}')`,
    [id, JSON.stringify({ name: 'bob' }), ADMIN],
  );
  return rows[0] ?? { id: '', resent: null };
}

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('環境変数 SUPABASE_DB_URL が設定されていません(@kaninabe/runtime/testing/local/local-supabase.mts)。');
  }
  client = new Client({ connectionString });
  other = new Client({ connectionString });
  await client.connect();
  await other.connect();
  await client.query(`drop function if exists api.${FN}(uuid, jsonb, uuid, text[])`);
  await client.query(`drop table if exists public.${STAFFS}, public.${EVENTS}, public.${SHOPS} cascade`);
  await client.query(`create table public.${SHOPS} (id uuid primary key, name text)`);
  await client.query(`insert into public.${SHOPS} values ($1, 'S')`, [SHOP]);
  // 外部キーの親は名前の順で前(xk_shops < xk_staffs)。挿入は既定値の列で親を指し、確かめが親の行を key share で掴む。
  await client.query(`create table public.${STAFFS} (id uuid primary key, name text not null, is_admin boolean not null default false,
    shop_id uuid not null default '${SHOP}' references public.${SHOPS} (id))`);
  await client.query(`create table public.${EVENTS} (
    id bigserial primary key, event_id text not null, entity text not null, entity_id uuid not null, actor_id uuid, payload jsonb,
    occurred_at timestamptz default now())`);
  await client.query(`insert into public.${STAFFS} values ($1, 'admin', true)`, [ADMIN]);
  await client.query(generatedSql());
});

afterAll(async () => {
  await client.query(`drop function if exists api.${FN}(uuid, jsonb, uuid, text[])`);
  await client.query(`drop table if exists public.${STAFFS}, public.${EVENTS}, public.${SHOPS} cascade`);
  await client.end();
  await other.end();
});

describe('作る表 = 実行者の表の作成 RPC の冪等キーの掴み(実 DB。点検 26 回目 D26-1)', () => {
  it('錨の行を消す txn が未コミットの間の押し直しは、消す側のコミットを待ち、行が消えたのを見て作り直しの断りになる(書けたと偽らない)', async () => {
    expect(await insertStaff(client)).toEqual({ id: ROW_ID, resent: null });
    await other.query('begin');
    await other.query(`delete from public.${STAFFS} where id = $1`, [ROW_ID]);
    let settled = false;
    const pressed = insertStaff(client).then(
      (row) => {
        settled = true;
        return { row, failure: null as PgFailure | null };
      },
      (error: unknown) => {
        settled = true;
        return { row: null, failure: error as PgFailure };
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    // 掴みが効いていれば、押し直しは消す側のコミットを待っている(掴まない本文は消える前の行を再送として即座に返す)。
    const waited = !settled;
    await other.query('commit');
    const outcome = await pressed;
    expect(waited).toBe(true);
    expect(outcome.row).toBeNull();
    expect(outcome.failure?.detail).toBe('resend_target_deleted');
    const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from public.${STAFFS} where id = $1`, [ROW_ID]);
    expect(rows).toEqual([{ n: '0' }]);
  });
});

describe('作成の挿入の外部キーの確かめと、親を先に排他で掴む txn(実 DB。点検 fix26 2 回目 D26b-1)', () => {
  it('親を排他で掴んでから実行者の行を共有で掴む txn と交錯しても 40P01 にならず、両方が通る', async () => {
    const codes: string[] = [];
    const record = (error: unknown): null => {
      codes.push((error as { code?: string }).code ?? 'unknown');
      return null;
    };
    await other.query('begin');
    await other.query(`select 1 from public.${SHOPS} t where t.id = $1 for update of t`, [SHOP]);
    // 作成: 実行者の行と冪等キーの行を掴み、挿入の外部キーの確かめで親の行(other が排他で持つ)を待つ。
    const created = insertStaff(client, RING_ID).catch(record);
    await new Promise((resolve) => setTimeout(resolve, 700));
    // 親を持つ txn が実行者の行を共有で掴む(生成 RPC の表名の順: xk_shops → xk_staffs)。作成が排他で持っていれば輪になる。
    const ring = await other
      .query(`select 1 from public.${STAFFS} la where la.id = $1 for share of la`, [ADMIN])
      .then(() => other.query(`update public.${SHOPS} set name = 'S2' where id = $1`, [SHOP]))
      .then(() => other.query('commit'))
      .catch(async (error: unknown) => {
        record(error);
        await other.query('rollback');
        return null;
      });
    const row = await created;
    expect(codes).toEqual([]);
    expect(ring).not.toBeNull();
    expect(row).toEqual({ id: RING_ID, resent: null });
  });
});
