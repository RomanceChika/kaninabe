/**
 * RLS の migration の組み立て(lib/sql/rls-migration.ts + rls-predicate.ts)のテスト。
 *
 * 述語の写像(設計 束 ⑳-4a §2)を 1 形ずつ固定する。
 *
 * | `reads` の形 | `using (…)` |
 * |---|---|
 * | `scope: all`(セッション / claim のロール) | 補助関数 |
 * | `scope: all`(未ログイン) | `true`(根拠は `to anon`) |
 * | `scope: own` | 対象の行の列と実行者 id の比較 |
 * | `scope: context(X)` | X まで参照を辿る EXISTS(2 段も 1 段に畳む) |
 * | `filters` | 列 = **実行者の行の欄**(補助関数 `public.actor_{欄}()` を `(select …)` で 1 回だけ評価。JWT は読まない) |
 * | `filters`(親の列) | 親の列(参照の鎖をスカラー副問い合わせで辿る)= 同上 |
 * | `when` | **行の状態の条件**(同じガード式の翻訳器で写す。束 §14) |
 *
 * 実 DB との一致は `app/src/infrastructure/__tests__/rls/policy-parity.test.ts` が
 * 「生成ファイルをトランザクションで適用して `pg_policies` を読み直す」形で見る。
 */

import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_PLATFORM } from '../../helpers/platform.js';
import type { PlatformProfile } from '../../../lib/model/product/platform-profile.js';
import { describe, expect, it } from 'vitest';
import { buildBoundaryHelperMigration, buildHelperMigration, buildPolicyMigration } from '../../../lib/sql/rls-migration.js';
import { policyPlans } from '../../../lib/world/rls-plan.js';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../helpers/model-builder.js';

/** 題材: 明細(line)→ 申請(claim)→ 従業員(employee)の 2 段の参照。 */
const roles: readonly RoleDef[] = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('employee', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
  { ...role('accountant', undefined, ['employee']), claim: 'employee.is_accountant' },
  role('claim_owner', 'claim.employee_id == actor.id', ['employee']),
  role('line_owner', 'line.employee_id == actor.id', ['employee']),
]).roles;

/** テーブル名の引き当て(集約名 → 物理テーブル)。 */
const tableOf = (entity: string): string | null =>
  ({ line: 'lines', claim: 'claims', employee: 'employees' })[entity] ?? null;

/** ドメイン仕様(欄は述語に要るものだけ)。 */
function domain(): SpecModel {
  return specModel(
    [
      aggregate('line', {
        entity: entitySpec('line', {
          // 他集約へ届く道は `context:` の宣言が正である(employee への ref が 2 本あるので、
          // どちらで辿るかはここでしか決まらない。ref-path.ts)。
          context: { line: 'line.id', claim: 'line.claim_id', employee: 'line.employee_id' },
          fields: [
            field('id', { kind: 'uuid' }),
            field('claim_id', { kind: 'ref', entity: 'claim' }, { required: true }),
            field('employee_id', { kind: 'ref', entity: 'employee' }),
            field('company_id', { kind: 'ref', entity: 'employee' }),
            // 状態の条件(`reads[].when`)が読む欄。ここでは enum で足りる(状態機械の宣言は
            // 述語の写像に効かない —— 効くのは値の種別だけである)。
            field('state', { kind: 'enum', values: ['open', 'archived'] }),
          ],
        }),
      }),
      aggregate('claim', {
        entity: entitySpec('claim', {
          context: { claim: 'claim.id', employee: 'claim.employee_id' },
          fields: [
            field('id', { kind: 'uuid' }),
            field('employee_id', { kind: 'ref', entity: 'employee' }, { required: true }),
            // 親の列で狭める境界(`claim.company_id`)が読む列。
            field('company_id', { kind: 'ref', entity: 'employee' }),
            field('state', { kind: 'enum', values: ['open', 'archived'] }),
          ],
        }),
      }),
      aggregate('employee', {
        entity: entitySpec('employee', {
          context: { employee: 'employee.id' },
          fields: [
            field('id', { kind: 'uuid' }),
            field('is_accountant', { kind: 'boolean' }, { session: true }),
            field('company_id', { kind: 'ref', entity: 'employee' }, { session: true }),
          ],
        }),
      }),
    ],
    roleSpec([...roles]),
  );
}

/** 対象の表のポリシー migration を組み立てて全文を返す。 */
function policies(
  entity: string,
  table: string,
  reads: Parameters<typeof read>[],
  platform: PlatformProfile = TEST_PLATFORM,
): string {
  const access = accessSpec(entity, { reads: reads.map((args) => read(...args)) });
  const model = domain();
  const result = buildPolicyMigration({
    plans: policyPlans(access, table, roles),
    entity,
    table,
    domain: model,
    tableOf,
    roles,
    platform,
    specFiles: ['docs/specs/domain/line/access.md'],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('\n'));
  return result.sql;
}

describe('buildPolicyMigration — 述語の写像', () => {
  it('セッションから立つロールと claim のロールは補助関数を呼ぶ', () => {
    const sql = policies('line', 'lines', [
      ['employee', 'all'],
      ['accountant', 'all'],
    ]);
    expect(sql).toContain('using (public.is_employee());');
    expect(sql).toContain('using (public.is_accountant());');
  });

  it('未ログインのロールは to anon, authenticated で、述語は true になる', () => {
    const sql = policies('line', 'lines', [['anonymous', 'all']]);
    // ログイン中の人にも同じに効く(ログインしたことで見られなくなってはならない)。
    expect(sql).toContain('    for select to anon, authenticated\n    using (true);');
    expect(sql).toContain('grant select on public.lines to anon, authenticated;');
  });

  it('scope: own は対象の行の列と実行者 id を比べる(EXISTS を開かない)', () => {
    const sql = policies('line', 'lines', [['line_owner', 'own']]);
    expect(sql).toContain('using (coalesce(((lines.employee_id) = ((select auth.uid()))), false));');
    expect(sql).not.toContain('exists (select 1 from public.lines');
  });

  it('scope: context(X) は X まで参照を辿る EXISTS になる', () => {
    const sql = policies('line', 'lines', [['claim_owner', 'context(claim)']]);
    expect(sql).toContain(
      'using (exists (select 1 from public.claims b where b.id = lines.claim_id and ' +
        'coalesce(((b.employee_id) = ((select auth.uid()))), false)));',
    );
  });

  it('境界(filters)は実行者の行の欄(補助関数)と比べ、式全体を 1 回だけ 2 値に畳む', () => {
    const sql = policies('line', 'lines', [['employee', 'all', { company_id: 'company_id' }]]);
    expect(sql).toContain(
      'using (coalesce(public.is_employee() and lines.company_id = (select public.actor_company_id()), false));',
    );
    // セッションの写し(トークンの属性)は読まない —— 写しはトークンの寿命だけ古い。
    expect(sql).not.toContain('auth.jwt()');
    expect(sql).not.toContain('app_metadata');
  });

  it('境界の左辺が親の列なら、参照の鎖をスカラー副問い合わせで辿って比べる(名前に集約も付く)', () => {
    const sql = policies('line', 'lines', [['employee', 'all', { 'claim.company_id': 'company_id' }]]);
    expect(sql).toContain('create policy lines_select_employee_all_within_claim_company_id on public.lines');
    expect(sql).toContain(
      'using (coalesce(public.is_employee() and (select w_claim.company_id from public.claims w_claim ' +
        'where w_claim.id = lines.claim_id) = (select public.actor_company_id()), false));',
    );
  });

  it('境界の右辺が actor.id なら補助関数を経ず、実行者 id の式と比べる', () => {
    const sql = policies('line', 'lines', [['employee', 'all', { employee_id: 'id' }]]);
    expect(sql).toContain('lines.employee_id = (select auth.uid())');
    expect(sql).not.toContain('actor_id()');
  });

  it('境界の両辺の値の種別が違えば写さない(V2 と二重に閉じる)', () => {
    const access = accessSpec('line', { reads: [read('employee', 'all', { 'claim.state': 'company_id' })] });
    const result = buildPolicyMigration({
      plans: policyPlans(access, 'lines', roles),
      entity: 'line',
      table: 'lines',
      domain: domain(),
      tableOf,
      roles,
      platform: TEST_PLATFORM,
      specFiles: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.counterexample['unwritable']).toBe('kind_mismatch');
  });

  it('境界の親へ context で届かなければ写さない(黙って自分の列に読み替えない)', () => {
    const access = accessSpec('claim', { reads: [read('employee', 'all', { 'line.company_id': 'company_id' })] });
    const result = buildPolicyMigration({
      plans: policyPlans(access, 'claims', roles),
      entity: 'claim',
      table: 'claims',
      domain: domain(),
      tableOf,
      roles,
      platform: TEST_PLATFORM,
      specFiles: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.counterexample['unwritable']).toBe('unreachable');
  });

  it('状態の条件(when)は境界と同じ論理積に入り、由来のコメントにも出る', () => {
    const sql = policies('line', 'lines', [
      ['employee', 'all', { company_id: 'company_id' }, 'line.state != archived'],
    ]);
    expect(sql).toContain(
      'using (coalesce(public.is_employee() and lines.company_id = (select public.actor_company_id()) and ' +
        "coalesce(((lines.state) <> 'archived'), false), false));",
    );
    expect(sql).toContain("-- 行の状態で見え方を絞る条件: line.state != archived");
  });

  it('状態の条件は親の欄も読める(参照の鎖をスカラー副問い合わせで辿る)', () => {
    const sql = policies('line', 'lines', [['employee', 'all', undefined, 'claim.state != archived']]);
    expect(sql).toContain(
      'using (coalesce(public.is_employee() and coalesce((((select w_claim.state from public.claims ' +
        "w_claim where w_claim.id = lines.claim_id)) <> 'archived'), false), false));",
    );
  });

  it('状態の条件に実行者が現れたら写さない(V2 と二重に閉じる)', () => {
    const access = accessSpec('line', {
      reads: [read('employee', 'all', undefined, 'line.employee_id == actor.id')],
    });
    const result = buildPolicyMigration({
      plans: policyPlans(access, 'lines', roles),
      entity: 'line',
      table: 'lines',
      domain: domain(),
      tableOf,
      roles,
      platform: TEST_PLATFORM,
      specFiles: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('状態の条件');
    expect(result.problems[0]?.counterexample['unwritable']).toContain('actor.id');
  });

  it('権限を落としてから付け直し、RLS を有効にする', () => {
    const sql = policies('line', 'lines', [['employee', 'all']]);
    expect(sql).toContain('revoke all on public.lines from anon, authenticated;');
    expect(sql).toContain('grant select on public.lines to authenticated;');
    expect(sql).toContain('alter table public.lines enable row level security;');
  });

  it('ポリシーは drop してから create する(何度流しても同じ結果になる)', () => {
    const sql = policies('line', 'lines', [['employee', 'all']]);
    expect(sql).toContain('drop policy if exists lines_select_employee_all on public.lines;');
    expect(sql).toContain('create policy lines_select_employee_all on public.lines');
  });

  it('読めるロールが 1 つも無ければ grant を出さない(RLS の有効化だけ残る)', () => {
    const sql = policies('line', 'lines', [['employee', 'none']]);
    expect(sql).not.toContain('grant select');
    expect(sql).toContain('alter table public.lines enable row level security;');
    // 許可ポリシーは 1 本も出ない(制限ポリシーだけが残る)。
    expect(sql).not.toContain('create policy lines_select');
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql).toContain('create policy lines_session_alive on public.lines');
  });

  it('全ての表にログインセッションの生死を要求する制限ポリシーが 1 本ある(許可ポリシーの数・述語に依らない)', () => {
    for (const reads of [
      [['employee', 'all']],
      [['anonymous', 'all']],
      [['line_owner', 'own']],
      [['employee', 'none']],
    ] as Parameters<typeof read>[][]) {
      const sql = policies('line', 'lines', reads);
      expect(sql, JSON.stringify(reads)).toContain(
        [
          'drop policy if exists lines_session_alive on public.lines;',
          'create policy lines_session_alive on public.lines',
          '    as restrictive',
          '    for select to authenticated',
          '    using ((select api.session_alive()));',
        ].join('\n'),
      );
      expect(sql.match(/as restrictive/g), JSON.stringify(reads)).toHaveLength(1);
    }
  });

  it('制限ポリシーの宛先はログイン済みのロールだけである(未ログインのロールには効かない)', () => {
    const sql = policies('line', 'lines', [['anonymous', 'all']]);
    const restrictive = sql.slice(sql.indexOf('create policy lines_session_alive'));
    expect(restrictive).toContain('for select to authenticated\n');
    expect(restrictive).not.toContain('anon');
  });

  it('制限ポリシーは判定を (select …) で包む(行ごとでなく文ごとに 1 回だけ評価させる)', () => {
    const sql = policies('line', 'lines', [['employee', 'all']]);
    expect(sql).toContain('using ((select api.session_alive()));');
    expect(sql).not.toMatch(/using \(api\.session_alive\(\)\)/);
  });

  it('別のプラットフォームの設定では、スキーマ名もログイン済みのロール名も設定から引く', () => {
    const sql = policies('line', 'lines', [['employee', 'all']], FOREIGN_PLATFORM);
    expect(sql).toContain('    as restrictive\n    for select to signed_in\n    using ((select edge.session_alive()));');
    expect(sql).not.toContain('api.session_alive');
  });

  it('スコープと束縛の指す集約が食い違っていたら写さない(T7 が先に落とす前提)', () => {
    const access = accessSpec('claim', { reads: [read('line_owner', 'context(line)')] });
    const result = buildPolicyMigration({
      plans: policyPlans(access, 'claims', roles),
      entity: 'claim',
      table: 'claims',
      domain: domain(),
      tableOf,
      roles,
      platform: TEST_PLATFORM,
      specFiles: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('claims_select_line_owner_context');
  });
});

describe('buildHelperMigration — 補助関数', () => {
  it('セッションから立つロールは実行者の集約に行があるかを見る', () => {
    const target = roles.find((candidate) => candidate.id === 'employee');
    const result = buildHelperMigration({ role: target!, domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain('create or replace function public.is_employee() returns boolean');
    expect(result.sql).toContain('security definer');
    expect(result.sql).toContain('select exists (select 1 from public.employees a');
    expect(result.sql).toContain('where a.id = (select auth.uid()));');
    expect(result.sql).toContain('grant execute on function public.is_employee() to anon, authenticated, service_role;');
  });

  it('claim のロールは実行者の行の欄も条件にする', () => {
    const target = roles.find((candidate) => candidate.id === 'accountant');
    const result = buildHelperMigration({ role: target!, domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain('where a.id = (select auth.uid()) and a.is_accountant);');
  });

  it('claim の参照先が実在しなければ写さない', () => {
    const target: RoleDef = { ...role('ghost'), claim: 'nowhere.flag' };
    const result = buildHelperMigration({ role: target, domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('ghost');
  });
});

describe('buildBoundaryHelperMigration — 境界の補助関数', () => {
  it('実行者自身の行の欄を返す security definer の関数で、引数を持たない', () => {
    const result = buildBoundaryHelperMigration({ field: 'company_id', domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 戻り値の型は実行者の集約の欄の型(ref は uuid)。他人の行を引ける口(引数)を作らない。
    expect(result.sql).toContain('create or replace function public.actor_company_id() returns uuid');
    expect(result.sql).toContain('stable\nsecurity definer\nset search_path = public');
    expect(result.sql).toContain('    select a.company_id from public.employees a\n        where a.id = (select auth.uid());');
    expect(result.sql).toContain('revoke all on function public.actor_company_id() from public;');
    expect(result.sql).toContain('grant execute on function public.actor_company_id() to anon, authenticated, service_role;');
    expect(result.sql).not.toContain('auth.jwt()');
  });

  it('実行者の集約にその欄が無ければ写さない', () => {
    const result = buildBoundaryHelperMigration({ field: 'nowhere', domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('actor_nowhere');
  });

  it('別のプラットフォームの設定では、その実行者の式とロールを使う', () => {
    const result = buildBoundaryHelperMigration({ field: 'company_id', domain: domain(), tableOf, specFiles: [], platform: FOREIGN_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain('where a.id = (select ctx.actor_id());');
    expect(result.sql).toContain('grant execute on function public.actor_company_id() to visitor, signed_in, worker;');
    expect(leaksSupabaseSpelling(result.sql)).toBe(false);
  });
});

describe('別のプラットフォームの設定を渡すと(RLS の本文は設定の中身を知らない)', () => {
  const reads: Parameters<typeof read>[] = [
    ['anonymous', 'all'],
    ['employee', 'all', { company_id: 'company_id' }],
    ['line_owner', 'own'],
  ];
  const sql = policies('line', 'lines', reads, FOREIGN_PLATFORM);

  it('宛先のロール・権限の剥奪・実行者の式が設定から引かれる(境界はセッション属性の枝を読まない)', () => {
    expect(sql).toContain('revoke all on public.lines from visitor, signed_in;');
    expect(sql).toContain('for select to signed_in, visitor');
    expect(sql).toContain('for select to signed_in');
    expect(sql).toContain('grant select on public.lines to signed_in, visitor;');
    expect(sql).toContain('(select ctx.actor_id())');
    expect(sql).toContain('lines.company_id = (select public.actor_company_id())');
    expect(sql).not.toContain('ctx.claims');
  });

  it('補助関数は設定の実行者の式を読み、呼べる全ロールへ実行権限を与える', () => {
    const target = roles.find((candidate) => candidate.id === 'employee');
    const result = buildHelperMigration({ role: target!, domain: domain(), tableOf, specFiles: [], platform: FOREIGN_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain('where a.id = (select ctx.actor_id()));');
    expect(result.sql).toContain('grant execute on function public.is_employee() to visitor, signed_in, worker;');
    expect(leaksSupabaseSpelling(result.sql)).toBe(false);
  });

  it('Supabase の綴りが 1 つも残らない', () => {
    expect(leaksSupabaseSpelling(sql)).toBe(false);
    expect(leaksSupabaseSpelling(policies('line', 'lines', reads))).toBe(true);
  });
});

describe('識別子の長さ(PostgreSQL は 63 バイトを超える名前を黙って切り詰める)', () => {
  /** 名前の長さ(バイト)を指定してロール ID を作る。 */
  const roleOf = (id: string): RoleDef => ({ ...role(id, undefined, undefined, 'authenticated_default') });

  it('補助関数の名前(is_{ロール})が 63 バイトを超えたら写さない(切り詰められた先で別の関数と衝突しうる)', () => {
    const long = roleOf('r'.repeat(61)); // public.is_ は名前に含めず、`is_` + 61 = 64 バイト
    const result = buildHelperMigration({ role: long, domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('function');
    expect(result.problems[0]?.message).toContain('64 バイト');
    expect(result.problems[0]?.counterexample).toMatchObject({ kind: 'function', bytes: '64' });
  });

  it('補助関数の名前がちょうど 63 バイトなら写す(境界の値)', () => {
    const edge = roleOf('r'.repeat(60)); // `is_` + 60 = 63 バイト
    const result = buildHelperMigration({ role: edge, domain: domain(), tableOf, specFiles: [], platform: TEST_PLATFORM });

    expect(result.ok).toBe(true);
  });

  it('境界の補助関数の名前(actor_{欄})が 63 バイトを超えたら写さない', () => {
    const column = 'c'.repeat(58); // `actor_` + 58 = 64 バイト
    const withLong = specModel(
      [
        aggregate('employee', {
          entity: entitySpec('employee', {
            fields: [field('id', { kind: 'uuid' }), field(column, { kind: 'uuid' }, { session: true })],
          }),
        }),
      ],
      roleSpec([...roles]),
    );
    const result = buildBoundaryHelperMigration({ field: column, domain: withLong, tableOf, specFiles: [], platform: TEST_PLATFORM });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.counterexample).toMatchObject({ kind: 'function' });
  });

  it('ポリシーの名前({表}_select_{ロール}_{スコープ})が 63 バイトを超えたら写さない', () => {
    const longRole = roleOf('extremely_long_role_name_that_overflows_the_policy_limit');
    const allRoles = [...roles, longRole];
    const access = accessSpec('line', { reads: [read('extremely_long_role_name_that_overflows_the_policy_limit', 'all')] });
    const result = buildPolicyMigration({
      plans: policyPlans(access, 'lines', allRoles),
      entity: 'line',
      table: 'lines',
      domain: domain(),
      tableOf,
      roles: allRoles,
      platform: TEST_PLATFORM,
      specFiles: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.counterexample['kind'])).toContain('policy');
    expect(result.problems[0]?.suggestion).toContain('短くする');
  });
});
