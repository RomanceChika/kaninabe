/**
 * **凍結のトリガ**(`triggers[].freezes`。生成器 legacy/spec-tools/lib/sql/ddl-freeze-triggers.ts)が、凍らせた列を書き換える更新を
 * **経路を問わず**断ることの統合テスト(実 DB。点検 fix26 2 回目 D26b-2・3・5・7 の根の直し)。
 *
 * 「変える口が無い」を静的に証明する照らしが取りこぼした経路 —— BEFORE のトリガが NEW を書き換える・外部キーの連鎖(on update cascade)・
 * 列だけの権限(grant update (列))・動的 SQL(execute format) —— を 1 本ずつ実 DB で起こし、どれも不変条件の違反の口
 * (`check_violation`・制約名はトリガ名)で断られ、行が動かないことを見る。凍らせていない列の更新と、同じ値の代入は通る。
 *
 * 表も関数もロールも**このテストだけの名前**(`xf_` 接頭辞)で作り、最後に消す。トリガの SQL は仕様のリテラルから生成器を呼んで組み立てる。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freezeTriggersIn } from '../../lib/sql/ddl-freeze-triggers.js';
import { triggerStatements } from '../../lib/sql/ddl-guards.js';
import { dataTable } from '../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../helpers/model-builder.js';

const ITEMS = 'xf_items';
const PARENTS = 'xf_parents';
const FREEZE = 'xf_freeze_items';
const REWRITE = 'xf_rewrite_code';
const ROLE = 'xf_column_writer';

const PARENT = '00000000-0000-4000-8000-0000000000f1';
const OTHER_PARENT = '00000000-0000-4000-8000-0000000000f2';
const ITEM = '00000000-0000-4000-8000-0000000000e1';

/** 凍結のトリガの SQL(仕様のリテラル → 生成器)。凍らせるのは参照の列と code。 */
function generatedSql(): string {
  const domain = specModel([
    aggregate('parent', { entity: entitySpec('parent', { fields: [field('id', { kind: 'uuid' })] }) }),
    aggregate('item', {
      entity: entitySpec('item', {
        fields: [field('id', { kind: 'uuid' }), field('parent_id', { kind: 'ref', entity: 'parent' }), field('label', { kind: 'string' }), field('code', { kind: 'string' })],
      }),
    }),
  ]);
  const table = dataTable(ITEMS, {
    entity: 'item',
    triggers: [{ name: FREEZE, functionName: FREEZE, fires: 'after update', deferred: false, supplies: [], params: {}, freezes: ['parent_id', 'code'] }],
  });
  const [trigger] = freezeTriggersIn(table, domain);
  if (trigger === undefined) throw new Error('生成器が凍結のトリガを出せません');
  return triggerStatements(trigger, `public.${ITEMS}`).join('\n');
}

let client: Client;

/** pg のエラーの形。 */
interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
}

/** 文を流し、断られたらその理由を返す(通れば null)。 */
async function refusal(sql: string, values: readonly unknown[] = []): Promise<PgFailure | null> {
  try {
    await client.query(sql, [...values]);
    return null;
  } catch (error) {
    return error as PgFailure;
  }
}

/** 今の行。 */
async function row(): Promise<{ readonly parent_id: string; readonly code: string; readonly label: string }> {
  const { rows } = await client.query<{ parent_id: string; code: string; label: string }>(`select parent_id, code, label from public.${ITEMS} where id = $1`, [ITEM]);
  return rows[0] ?? { parent_id: '', code: '', label: '' };
}

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('環境変数 SUPABASE_DB_URL が設定されていません(@kaninabe/runtime/testing/local/local-supabase.mts)。');
  }
  client = new Client({ connectionString });
  await client.connect();
  await client.query(`drop table if exists public.${ITEMS}, public.${PARENTS} cascade`);
  await client.query(`drop function if exists public.${FREEZE}(), public.${REWRITE}() cascade`);
  await client.query(`drop role if exists ${ROLE}`);
  await client.query(`create table public.${PARENTS} (id uuid primary key)`);
  await client.query(`create table public.${ITEMS} (id uuid primary key, parent_id uuid not null references public.${PARENTS} (id) on update cascade, label text, code text)`);
  await client.query(`insert into public.${PARENTS} values ($1), ($2)`, [PARENT, OTHER_PARENT]);
  await client.query(`insert into public.${ITEMS} values ($1, $2, 'a', 'c1')`, [ITEM, PARENT]);
  await client.query(generatedSql());
  // BEFORE のトリガが NEW を書き換える経路(ラベルの更新に乗じて凍らせた列を書き換える)。
  await client.query(`create function public.${REWRITE}() returns trigger language plpgsql as $$
    begin
      if new.label = 'rewrite' then new.code := 'c2'; end if;
      return new;
    end;
  $$`);
  await client.query(`create trigger ${REWRITE} before update of label on public.${ITEMS} for each row execute function public.${REWRITE}()`);
  // 列だけの権限(表の update の権限は持たず、凍らせた列だけを書ける)。
  await client.query(`create role ${ROLE}`);
  // 接続の利用者(超利用者とは限らない)がこのロールに切り替えられるようにする。
  await client.query(`grant ${ROLE} to current_user`);
  await client.query(`grant usage on schema public to ${ROLE}`);
  await client.query(`grant select on public.${ITEMS} to ${ROLE}`);
  await client.query(`grant update (code) on public.${ITEMS} to ${ROLE}`);
});

afterAll(async () => {
  await client.query('reset role');
  await client.query(`drop table if exists public.${ITEMS}, public.${PARENTS} cascade`);
  await client.query(`drop function if exists public.${FREEZE}(), public.${REWRITE}() cascade`);
  await client.query(`revoke all on schema public from ${ROLE}`);
  await client.query(`drop role if exists ${ROLE}`);
  await client.end();
});

describe('凍結のトリガ(実 DB。点検 fix26 2 回目)', () => {
  it('凍らせた列を書き換える更新は、BEFORE のトリガ経由・外部キーの連鎖・列の権限・動的 SQL のどれでも断られ、行は動かない', async () => {
    const before = await row();
    const paths: readonly (readonly [string, () => Promise<PgFailure | null>])[] = [
      ['直の更新', () => refusal(`update public.${ITEMS} set code = 'c9' where id = $1`, [ITEM])],
      ['BEFORE のトリガが NEW を書き換える(SET はラベルだけ)', () => refusal(`update public.${ITEMS} set label = 'rewrite' where id = $1`, [ITEM])],
      ['外部キーの連鎖(親の id を変える on update cascade)', () => refusal(`update public.${PARENTS} set id = '00000000-0000-4000-8000-0000000000f9' where id = $1`, [PARENT])],
      [
        '列だけの権限(grant update (code))',
        async () => {
          await client.query(`set role ${ROLE}`);
          try {
            return await refusal(`update public.${ITEMS} set code = 'c8' where id = $1`, [ITEM]);
          } finally {
            await client.query('reset role');
          }
        },
      ],
      ['動的 SQL(execute format)', () => refusal(`do $$ begin execute format('update public.%I set %I = %L', '${ITEMS}', 'code', 'c7'); end $$`)],
      ['参照の列の付け替え', () => refusal(`update public.${ITEMS} set parent_id = $1 where id = $2`, [OTHER_PARENT, ITEM])],
    ];
    for (const [label, run] of paths) {
      const failure = await run();
      expect({ label, code: failure?.code, constraint: failure?.constraint }).toEqual({ label, code: '23514', constraint: FREEZE });
    }
    expect(await row()).toEqual(before);
  });

  it('凍らせていない列の更新と、凍らせた列への同じ値の代入は通る', async () => {
    expect(await refusal(`update public.${ITEMS} set label = 'b' where id = $1`, [ITEM])).toBeNull();
    expect(await refusal(`update public.${ITEMS} set code = code, parent_id = parent_id where id = $1`, [ITEM])).toBeNull();
    expect((await row()).label).toBe('b');
  });
});
