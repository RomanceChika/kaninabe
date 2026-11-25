/**
 * 別の集約の列との等式の**制約トリガ**(`cross-check-plan.ts` / `ddl-cross-check-body.ts`)を実 DB に当てて、
 * 両端のどちらから破っても**コミットが拒否される**ことの統合テスト(実 DB)。
 *
 * 仕様: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md §コミット時に評価する不変条件
 *       生成器: legacy/spec-tools/lib/sql/{cross-check-plan,ddl-cross-check-body,ddl-check-triggers}.ts
 *
 * 見るのは 7 つ。
 *   1. 正しい状態は通る(遅延なので、途中で食い違っても最終の姿が揃っていればコミットできる)
 *   2. 行の側(担当者の付け替え・行の組織の変更)から破ると、コミットが check_violation で拒否される
 *   3. 参照される側(担当者が別の組織へ移る)から破ると、コミットが拒否される(参照されていない行は動ける)
 *   4. NULL: 比較する列が空で相手の行が在れば拒否する(式全体を `COALESCE(…, false)` で閉じる)
 *   5. 拒否は制約名(トリガ名)と不変条件 ID を載せる(呼び出し側の写像が不変条件に写す)
 *   6. 同時実行: 相手の行を書き換える取引と、その行を指す行を作る取引が互いの未コミットを見られなくても、
 *      後からコミットする側が `for share` の待ち合わせで最新の姿を見て拒否する(書き込みの歪みが通らない)
 *   7. 隔離の水準: repeatable read は検査の前に拒否される(25000。古い snapshot で相手の確定した行を見落とす穴を塞ぐ)・
 *      同じ順序でも read committed は拒否で防がれる・serializable も検査の前に拒否される(SSI は read committed との交錯を
 *      検出しないので、隔離の水準を揃える運用に任せない。点検 D25s-3)
 *
 * 表も関数も**このテストだけの名前**(`xe_` 接頭辞)で作り、最後に消す。SQL は仕様のリテラルから生成器を呼んで
 * 組み立てる —— 手で書いたトリガを確かめても、生成器の正しさは何も言えない。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkTriggerOf } from '../../lib/sql/ddl-check-triggers.js';
import { triggerStatements } from '../../lib/sql/ddl-guards.js';
import type { DataTableSpec } from '../../lib/model/data/types.js';
import { dataTable } from '../helpers/data-builder.js';
import { CROSS_INVARIANT, crossDomain, hostTrigger, referencedTrigger, triggerFn } from '../helpers/cross-equality-fixture.js';

/** 物理テーブル名(製品の表と重ならない綴り)。 */
const TICKETS = 'xe_tickets';
const AGENTS = 'xe_agents';

/** トリガ名 = 関数名(製品の関数と重ならない綴り)。 */
const HOST_NAME = 'xe_check_ticket_agent_org';
const REFERENCED_NAME = 'xe_check_ticket_agent_org_on_agent';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';

/** 両端のトリガ宣言(生成器の入力)。 */
const HOST = hostTrigger({ name: HOST_NAME, functionName: HOST_NAME });
const REFERENCED = referencedTrigger({ name: REFERENCED_NAME, functionName: REFERENCED_NAME });

/** 両端の表(この題材の物理名)。 */
const TICKETS_TABLE: DataTableSpec = dataTable(TICKETS, { entity: 'ticket', triggers: [HOST], functions: [triggerFn(HOST_NAME)] });
const AGENTS_TABLE: DataTableSpec = dataTable(AGENTS, { entity: 'agent', triggers: [REFERENCED], functions: [triggerFn(REFERENCED_NAME)] });

/** 生成器の出力(関数と制約トリガ)を SQL にする。 */
function generatedSql(): string {
  const domain = crossDomain();
  const tables = [TICKETS_TABLE, AGENTS_TABLE];
  const host = checkTriggerOf(HOST, TICKETS_TABLE, domain, tables);
  const referenced = checkTriggerOf(REFERENCED, AGENTS_TABLE, domain, tables);
  if (!host.ok || !referenced.ok) throw new Error('生成器が本文を出せません');
  return [
    ...triggerStatements(host.trigger, `public.${TICKETS}`),
    ...triggerStatements(referenced.trigger, `public.${AGENTS}`),
  ].join('\n');
}

let client: Client;
let other: Client;

/** pg のエラーの形(制約違反のとき `code` と `constraint` が載る)。 */
interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
  readonly message: string;
}

/** 文を流して、失敗すれば pg のエラーを返す(成功なら null)。 */
async function failureOf(run: () => Promise<unknown>): Promise<PgFailure | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error as PgFailure;
  }
}

/** 担当者を作る。 */
async function agent(org: string | null): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`insert into public.${AGENTS} (org_id) values ($1) returning id`, [org]);
  return rows[0]?.id ?? '';
}

/** チケットを作る(自動コミット = その文のコミット時に遅延トリガが発火する)。 */
async function ticket(c: Client, org: string | null, agentId: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2) returning id`, [org, agentId]);
  return rows[0]?.id ?? '';
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
  await client.query(`drop table if exists public.${TICKETS}, public.${AGENTS} cascade`);
  await client.query(`create table public.${AGENTS} (id uuid primary key default gen_random_uuid(), org_id uuid)`);
  await client.query(`create table public.${TICKETS} (
    id uuid primary key default gen_random_uuid(), org_id uuid, queue_id uuid, team_id uuid,
    agent_id uuid not null references public.${AGENTS} (id))`);
  await client.query(generatedSql());
});

afterAll(async () => {
  await client.query(`drop table if exists public.${TICKETS}, public.${AGENTS} cascade`);
  await client.query(`drop function if exists public.${HOST_NAME}(), public.${REFERENCED_NAME}()`);
  await client.end();
  await other.end();
});

beforeEach(async () => {
  await client.query(`truncate public.${TICKETS}, public.${AGENTS} cascade`);
});

describe('別の集約の列との等式の制約トリガ(実 DB)', () => {
  it('揃った状態は通る(担当者と同じ組織のチケット・参照されない担当者の移動)', async () => {
    const a = await agent(ORG_A);
    await ticket(client, ORG_A, a);
    const free = await agent(ORG_A);
    await client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, free]);
    const { rows } = await client.query<{ org_id: string }>(`select org_id from public.${AGENTS} where id = $1`, [free]);
    expect(rows).toEqual([{ org_id: ORG_B }]);
  });

  it('遅延なので、途中で食い違っても最終の姿が揃っていればコミットできる', async () => {
    const a = await agent(ORG_A);
    const t = await ticket(client, ORG_A, a);
    await client.query('begin');
    await client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]);
    await client.query(`update public.${TICKETS} set org_id = $1 where id = $2`, [ORG_B, t]);
    await client.query('commit');
    const { rows } = await client.query<{ org_id: string }>(`select org_id from public.${TICKETS} where id = $1`, [t]);
    expect(rows).toEqual([{ org_id: ORG_B }]);
  });

  it('行の側: 別の組織の担当者を指すチケットは作れない(拒否は制約名と不変条件 ID を載せる)', async () => {
    const a = await agent(ORG_A);
    const failure = await failureOf(() => ticket(client, ORG_B, a));
    expect(failure?.code).toBe('23514');
    expect(failure?.constraint).toBe(HOST_NAME);
    expect(failure?.message).toContain(`${HOST_NAME}: ${CROSS_INVARIANT}:`);
    const { rows } = await client.query(`select 1 from public.${TICKETS}`);
    expect(rows).toHaveLength(0);
  });

  it('行の側: 担当者の付け替え(別の組織の担当者へ)と、行の組織の変更は拒否される', async () => {
    const a = await agent(ORG_A);
    const b = await agent(ORG_B);
    const t = await ticket(client, ORG_A, a);
    const reassign = await failureOf(() => client.query(`update public.${TICKETS} set agent_id = $1 where id = $2`, [b, t]));
    expect(reassign?.constraint).toBe(HOST_NAME);
    const moveRow = await failureOf(() => client.query(`update public.${TICKETS} set org_id = $1 where id = $2`, [ORG_B, t]));
    expect(moveRow?.constraint).toBe(HOST_NAME);
    const { rows } = await client.query<{ org_id: string; agent_id: string }>(`select org_id, agent_id from public.${TICKETS} where id = $1`, [t]);
    expect(rows[0]).toEqual({ org_id: ORG_A, agent_id: a });
  });

  it('参照される側: 担当者が別の組織へ移ると、その人を担当者にしているチケットと食い違うので拒否される', async () => {
    const a = await agent(ORG_A);
    await ticket(client, ORG_A, a);
    const failure = await failureOf(() => client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]));
    expect(failure?.code).toBe('23514');
    expect(failure?.constraint).toBe(REFERENCED_NAME);
    expect(failure?.message).toContain(`${REFERENCED_NAME}: ${CROSS_INVARIANT}:`);
    const { rows } = await client.query<{ org_id: string }>(`select org_id from public.${AGENTS} where id = $1`, [a]);
    expect(rows[0]?.org_id).toBe(ORG_A);
  });

  it('NULL: 行の組織が空なら拒否する(相手の行が在る)', async () => {
    const a = await agent(ORG_A);
    const failure = await failureOf(() => ticket(client, null, a));
    expect(failure?.constraint).toBe(HOST_NAME);
  });

  it('NULL: 担当者の組織が空でも、その人を指すチケットが在れば拒否する(双方の端で)', async () => {
    const empty = await agent(null);
    const onHost = await failureOf(() => ticket(client, ORG_A, empty));
    expect(onHost?.constraint).toBe(HOST_NAME);
    const a = await agent(ORG_A);
    await ticket(client, ORG_A, a);
    const onReferenced = await failureOf(() => client.query(`update public.${AGENTS} set org_id = null where id = $1`, [a]));
    expect(onReferenced?.constraint).toBe(REFERENCED_NAME);
  });

  it('同時実行: 担当者の組織を変える取引が先に更新していれば、後からコミットするチケットの作成は最新の姿で拒否される', async () => {
    const a = await agent(ORG_A);
    // A: 担当者の組織を変えた(未コミット。この時点のチケットは 0 件なので A の検査は通る)。
    await client.query('begin');
    await client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]);
    // B: 古い組織のまま担当者を指すチケットを作る(A の未コミットの変更は見えない。外部キーの検査は A の行ロックと衝突しない)。
    await other.query('begin');
    await other.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
    // B のコミット時の検査は担当者の行を for share で押さえようとして A のコミットまで待つ。
    const bCommit = failureOf(() => other.query('commit'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.query('commit');
    const failure = await bCommit;
    expect(failure?.constraint).toBe(HOST_NAME);
    await other.query('rollback').catch(() => undefined);
    const { rows } = await client.query(`select 1 from public.${TICKETS}`);
    expect(rows).toHaveLength(0);
  });

  it('同時実行: 先にチケットを作る取引がコミットすれば、担当者の組織を変える取引のコミットは拒否される', async () => {
    const a = await agent(ORG_A);
    await other.query('begin');
    await other.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
    await other.query('commit');
    const failure = await failureOf(() => client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]));
    expect(failure?.constraint).toBe(REFERENCED_NAME);
  });

  describe('隔離の水準(外部レビュー の反例の順序)', () => {
    /**
     * 担当者 a(組織 A・チケット無し)から始め、T1(`level`)が snapshot を確定 → T2 が (a, 組織 A) のチケットを作って確定
     * (host の検査は a を `for share` で押さえるだけで、a 本体は更新しない)→ T1 が a の組織を B へ更新してコミット、の順に流す。
     * T2 の水準は read committed(外部レビュー の順序。T2 が repeatable read ならチケットの作成の側が拒否されて反例にならない)。
     * @returns T1 のコミットの失敗(成功なら null)
     */
    async function staleSnapshotOrder(level: string): Promise<{ readonly agentId: string; readonly t1: PgFailure | null }> {
      const a = await agent(ORG_A);
      await client.query(`begin isolation level ${level}`);
      await client.query(`select count(*) from public.${TICKETS}`);
      await other.query('begin isolation level read committed');
      await other.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
      await other.query('commit');
      const t1 = await failureOf(async () => {
        await client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]);
        await client.query('commit');
      });
      await client.query('rollback').catch(() => undefined);
      return { agentId: a, t1 };
    }

    /** a の組織とチケットの組織が食い違うチケットの件数。 */
    async function mismatches(): Promise<number> {
      const { rows } = await client.query<{ n: string }>(
        `select count(*) as n from public.${TICKETS} t join public.${AGENTS} r on r.id = t.agent_id where t.org_id is distinct from r.org_id`,
      );
      return Number(rows[0]?.n);
    }

    it('REPEATABLE READ: 古い snapshot の取引は、参照される側の更新のコミットで拒否される(25000・名前も不変条件 ID も載せない)', async () => {
      const { t1 } = await staleSnapshotOrder('repeatable read');
      expect(t1?.code).toBe('25000');
      expect(t1?.constraint).toBeUndefined();
      expect(t1?.message).toContain('repeatable read');
      expect(t1?.message).not.toContain(CROSS_INVARIANT);
      expect(t1?.message).not.toContain(REFERENCED_NAME);
      expect(await mismatches()).toBe(0);
    });

    it('REPEATABLE READ: 行の側(チケットの作成)も検査の前に拒否される(25000)', async () => {
      const a = await agent(ORG_A);
      await client.query('begin isolation level repeatable read');
      await client.query(`select count(*) from public.${AGENTS}`);
      const refused = await failureOf(async () => {
        await client.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
        await client.query('commit');
      });
      await client.query('rollback').catch(() => undefined);
      expect(refused?.code).toBe('25000');
      expect(refused?.constraint).toBeUndefined();
      const { rows } = await client.query(`select 1 from public.${TICKETS}`);
      expect(rows).toHaveLength(0);
    });

    it('READ COMMITTED: 同じ順序でも、参照される側の検査が確定したチケットを見て違反を拒否する(対照)', async () => {
      const { t1 } = await staleSnapshotOrder('read committed');
      expect(t1?.code).toBe('23514');
      expect(t1?.constraint).toBe(REFERENCED_NAME);
      expect(await mismatches()).toBe(0);
    });

    it('SERIALIZABLE: 行の側(チケットの作成)も参照される側の更新も、検査の前に拒否される(25000。SSI は read committed の取引との交錯を検出しないので、隔離の水準を揃える運用に任せない。点検 D25s-3)', async () => {
      const a = await agent(ORG_A);
      await client.query('begin isolation level serializable');
      await client.query(`select count(*) from public.${AGENTS}`);
      const hostRefused = await failureOf(async () => {
        await client.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
        await client.query('commit');
      });
      await client.query('rollback').catch(() => undefined);
      expect(hostRefused?.code).toBe('25000');
      expect(hostRefused?.message).toContain('serializable');
      // 参照される側: read committed のチケットの作成の後に、serializable の取引が担当者の組織を変える(以前は SSI に任せていた順序)。
      await other.query('begin isolation level read committed');
      await other.query(`insert into public.${TICKETS} (org_id, agent_id) values ($1, $2)`, [ORG_A, a]);
      await other.query('commit');
      await client.query('begin isolation level serializable');
      const referencedRefused = await failureOf(async () => {
        await client.query(`update public.${AGENTS} set org_id = $1 where id = $2`, [ORG_B, a]);
        await client.query('commit');
      });
      await client.query('rollback').catch(() => undefined);
      expect(referencedRefused?.code).toBe('25000');
      expect(referencedRefused?.message).not.toContain(CROSS_INVARIANT);
      expect(await mismatches()).toBe(0);
    });
  });
});
