/**
 * **ログインセッションの生死を DB で要求する**保証の見張り(`fw_session_alive_rls`。ASVS V7.4.1)。
 *
 * サインアウト・強制終了でセッションが終わっても、発行済みのアクセストークンは期限(既定 1 時間)まで署名として有効なまま残り、
 * PostgREST に直接提示すると RLS のとおりに行が読めた。これを閉じるのが、生成する全ての表の制限ポリシー(`{表}_session_alive`)と、
 * それが呼ぶ土台の関数 `session_alive` である。
 *
 *   - 生成する RLS の migration は、許可ポリシーの数・述語に依らず、ログイン済みのロール宛ての制限ポリシーを 1 本だけ出す
 *   - 土台の関数は持ち主の権限・空の `search_path` で、プラットフォームの設定の式(識別子が無ければ偽)をそのまま本文に持つ
 *   - リポジトリに置いた生成物(宣言した全ての `policies_migration`)が、その形のままである
 *
 * 検査の表(止める形・通る形の全部)は `unit/sql/rls-migration.test.ts` と `unit/sql/api-base.test.ts` が持ち、ここは台帳の見張りとして
 * 最小の組を固定する。実 DB での挙動(サインアウト・強制終了・期限切れの後に 0 行になること)は製品の統合テスト(保証 `session_tokens_server_only`)が見る。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRepoRoot } from '../../lib/io/paths.js';
import { apiBaseFunctions, buildApiBaseMigration } from '../../lib/sql/api-base.js';
import { buildPolicyMigration } from '../../lib/sql/rls-migration.js';
import { policyPlans } from '../../lib/world/index.js';
import type { RoleDef } from '../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, field, read, role, roleSpec, specModel } from '../helpers/model-builder.js';
import { FOREIGN_PLATFORM, TEST_PLATFORM } from '../helpers/platform.js';

/** リポジトリのルート。 */
const REPO_ROOT = detectRepoRoot(import.meta.dirname);

/** 題材: 明細(line)。ロールは未ログイン・ログイン済み(employee)・内部実行。 */
const ROLES: readonly RoleDef[] = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('employee', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
]).roles;

/** 読み取りの宣言から、生成した RLS の migration を組み立てる。 */
function policiesFor(reads: readonly Parameters<typeof read>[], platform = TEST_PLATFORM): string {
  const access = accessSpec('line', { reads: reads.map((args) => read(...args)) });
  const model = specModel(
    [aggregate('line', { entity: entitySpec('line', { context: { line: 'line.id' }, fields: [field('id', { kind: 'uuid' })] }), access })],
    roleSpec([...ROLES]),
  );
  const result = buildPolicyMigration({
    plans: policyPlans(access, 'lines', ROLES),
    entity: 'line',
    table: 'lines',
    domain: model,
    tableOf: (entity) => (entity === 'line' ? 'lines' : null),
    roles: ROLES,
    platform,
    specFiles: [],
  });
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('\n'));
  return result.sql;
}

describe('ログインセッションの生死を DB で要求する(V7.4.1)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONALIVE-001
  it('全ての表にログインセッションの生死を要求する制限ポリシーが 1 本ある(許可ポリシーの数・述語に依らない・ログイン済みのロールだけが宛先)', () => {
    const cases: readonly (readonly Parameters<typeof read>[])[] = [
      [['employee', 'all']],
      [['anonymous', 'all']],
      [['employee', 'none']],
      [
        ['anonymous', 'all'],
        ['employee', 'all'],
      ],
    ];
    for (const reads of cases) {
      const sql = policiesFor(reads);
      const label = JSON.stringify(reads);
      expect(sql.match(/as restrictive/gu), label).toHaveLength(1);
      expect(sql, label).toContain(
        [
          'drop policy if exists lines_session_alive on public.lines;',
          'create policy lines_session_alive on public.lines',
          '    as restrictive',
          '    for select to authenticated',
          '    using ((select api.session_alive()));',
        ].join('\n'),
      );
    }
    // 宛先と呼ぶ関数はプラットフォームの設定から引く(綴りの直書きではない)。
    expect(policiesFor([['employee', 'all']], FOREIGN_PLATFORM)).toContain(
      '    as restrictive\n    for select to signed_in\n    using ((select edge.session_alive()));',
    );
  });

  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONALIVE-002
  it('生死を答える土台の関数は、持ち主の権限・空の search_path で認証基盤のセッションの表を引き、識別子が無ければ偽になる式を持つ', () => {
    const functions = apiBaseFunctions(TEST_PLATFORM);
    const alive = functions.find((fn) => fn.name === 'session_alive');
    expect(alive).toMatchObject({ returns: 'boolean', definer: true, body: `select ${TEST_PLATFORM.sessionAliveExpr};` });
    // 持ち主の権限で実行するのはこの 1 本だけ(実行者の解決の 2 本は呼び出し主体の権限のまま)。
    expect(functions.filter((fn) => fn.definer).map((fn) => fn.name)).toEqual(['session_alive']);

    const sql = buildApiBaseMigration(TEST_PLATFORM);
    expect(sql).toContain(
      ['create or replace function api.session_alive() returns boolean', 'language sql', 'stable', 'security definer', "set search_path = ''", 'as $$'].join('\n'),
    );
    // 式: セッションの表の主キーを識別子で引く。識別子が無い(null)・空なら行は見つからず偽。期限切れも偽。
    expect(TEST_PLATFORM.sessionAliveExpr).toContain("s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid");
    expect(TEST_PLATFORM.sessionAliveExpr).toContain('s.not_after is null or s.not_after > now()');
  });

  /** 仕様の表が宣言した `policies_migration` のファイル名(data_table の前書き)。 */
  function declaredPolicyMigrations(): readonly { readonly table: string; readonly file: string }[] {
    const dir = join(REPO_ROOT, 'docs', 'specs', 'backend', 'data', 'tables');
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md') && !name.startsWith('template'))
      .flatMap((name) => {
        const head = readFileSync(join(dir, name), 'utf8').split('\n---\n')[0] ?? '';
        const table = /^table: (\w+)$/mu.exec(head)?.[1];
        const file = /^policies_migration: (\S+)$/mu.exec(head)?.[1];
        return table === undefined || file === undefined ? [] : [{ table, file }];
      });
  }

  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONALIVE-003
  it('宣言した全ての policies_migration が、その表の制限ポリシーを (select …) で包んで持つ(許可ポリシーだけの古い生成物を残さない)', () => {
    const declared = declaredPolicyMigrations();
    expect(declared.length, '走査が空振りしている').toBeGreaterThanOrEqual(4);

    const missing: string[] = [];
    for (const { table, file } of declared) {
      const sql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', file), 'utf8');
      const create = `create policy ${table}_session_alive on public.${table}\n    as restrictive\n    for select to authenticated\n    using ((select api.session_alive()));`;
      if (!sql.includes(create) || sql.match(/as restrictive/gu)?.length !== 1) missing.push(`${table} (${file})`);
    }
    expect(missing).toEqual([]);
  });
});
