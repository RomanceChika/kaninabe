/**
 * 関数の実行権限の閉世界(`lib/sql/function-acl.ts` + `grants-migration.ts` の関数の節)のユニットテスト。
 *
 * 規約網羅(セキュリティ: 関数は作った瞬間に PUBLIC へ実行権限が開き、プラットフォームの既定では
 * 面のロールにも名指しで付く。`revoke … from public` はその名指しの付与に触れない):
 *   - 面のロールから呼んでよい関数は仕様から導ける —— 土台の 3 本・隠し列の述語・RLS 補助関数
 *   - 宣言した関数は宛先を変えない(剥奪の対象から外す)。ほかの全関数は PUBLIC と面のロールを外す
 *   - 書き込みの RPC・トリガ関数は宣言に載らない(足しても計画は変わらない)
 *   - 以降に作る関数の既定の付与も外す。拡張が持つ関数は触らない。スキーマが無くても落ちない
 *   - 設定の中身を知らない(別の設定では綴りが全部変わる)
 */

import { describe, expect, it } from 'vitest';
import { functionAclPlan } from '../../../lib/sql/function-acl.js';
import { buildGrantsMigration, grantPlans } from '../../../lib/sql/grants-migration.js';
import { dataTable } from '../../helpers/data-builder.js';
import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_PLATFORM } from '../../helpers/platform.js';
import { accessSpec, aggregate, entitySpec, field, fieldHiddenRule, readRule, specModel } from '../../helpers/model-builder-v8plus.js';

/** 隠し列を 1 本持つ集約 1 つ。 */
const DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [field('id', { kind: 'uuid' }), field('internal_note', { kind: 'text' })]),
      access: accessSpec('widget', {
        reads: [readRule('member', { kind: 'all' })],
        fieldsHidden: [fieldHiddenRule('internal_note', ['member'])],
      }),
    }),
  ],
});

/** RPC・トリガ・補助関数を 1 つずつ持つ表。 */
const TABLES = [
  dataTable('widgets', {
    entity: 'widget',
    functions: [
      { name: 'update_widget', args: ['uuid'], params: ['p_a'], kind: 'rpc', alsoWrites: [] },
      { name: 'check_entry_capacity', args: [], params: [], kind: 'trigger', alsoWrites: [] },
      { name: 'is_staff', args: [], params: [], kind: 'helper', alsoWrites: [] },
    ],
  }),
];

describe('関数の実行権限の計画(面のロールから呼んでよい関数は仕様から導ける)', () => {
  const plan = functionAclPlan({ model: DOMAIN, tables: TABLES, platform: TEST_PLATFORM });
  const byName = Object.fromEntries(plan.callable.map((fn) => [fn.identity, fn.grantees]));

  it('土台の 3 本(セッションの生死を含む)・隠し列の述語・補助関数が載り、宛先は呼べる全ロールである', () => {
    expect(Object.keys(byName)).toEqual([
      'api.actor_id()',
      'api.can_see_widgets_internal_note(public.widgets)',
      'api.is_end_user()',
      'api.session_alive()',
      'public.is_staff()',
    ]);
    for (const grantees of Object.values(byName)) {
      expect(grantees).toEqual(['anon', 'authenticated', 'service_role']);
    }
  });

  it('書き込みの RPC もトリガ関数も載らない(足しても剥奪の対象になる側である)', () => {
    for (const identity of Object.keys(byName)) {
      expect(identity).not.toMatch(/update_widget|check_entry_capacity/u);
    }
  });

  it('剥奪の対象のスキーマと、外すロールが設定から引かれる', () => {
    expect(plan.schemas).toEqual(['public', 'api']);
    expect(plan.revokeFrom).toEqual(['anon', 'authenticated']);
  });

  it('関数を作る役が設定から引かれる(新しい関数の既定を役ごとに閉じる入力)', () => {
    expect(plan.requiredCreators).toEqual(['postgres']);
    expect(plan.externalCreators.map((creator) => creator.role)).toEqual(['supabase_admin']);
    expect(plan.externalCreators[0]?.reason).not.toBe('');
  });

  it('宣言は署名まで含む(同じ名前の別の overload は載らない)', () => {
    const withArgs = functionAclPlan({
      model: DOMAIN,
      tables: [
        dataTable('members', {
          functions: [{ name: 'is_staff', args: ['uuid'], params: [], kind: 'helper', alsoWrites: [] }],
        }),
      ],
      platform: TEST_PLATFORM,
    });
    const identities = withArgs.callable.map((fn) => fn.identity);
    expect(identities).toContain('public.is_staff(uuid)');
    expect(identities).not.toContain('public.is_staff()');
  });
});

describe('関数の実行権限の migration の節', () => {
  const plan = functionAclPlan({ model: DOMAIN, tables: TABLES, platform: TEST_PLATFORM });
  const sql = buildGrantsMigration(grantPlans([], TEST_PLATFORM), plan);

  it('宣言の外の関数から PUBLIC と面のロールの実行権限を外す(revoke … from public だけでは足りない)', () => {
    expect(sql).toContain('from public, anon, authenticated');
  });

  it('宣言した関数は剥奪の対象から外れる(自分の migration の grant execute が生きる)', () => {
    for (const identity of [
      'api.actor_id()',
      'api.is_end_user()',
      'api.can_see_widgets_internal_note(public.widgets)',
      'public.is_staff()',
    ]) {
      expect(sql).toContain(`'${identity}'`);
    }
  });

  it('宣言は署名まで含めて当てる(名前だけの除外に同名の別 overload が紛れない。宣言が DB に無くても全件が不明にならない)', () => {
    expect(sql).toContain('where to_regprocedure(declared.identity)::oid = p.oid');
    expect(sql).toContain('and not exists (');
    expect(sql).not.toContain('<> all');
    expect(sql).not.toContain('p.proname) <>');
  });

  it('関数の一覧は流す時点の DB から引く(種別を問わない全部・拡張が持つ関数は除く)', () => {
    expect(sql).toContain("where n.nspname in ('public', 'api')");
    // 通常の関数だけに絞らない(手続き・集約・ウィンドウ関数が開いたまま残る)。
    expect(sql).not.toContain('prokind');
    expect(sql).toContain("not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')");
    // 剥奪と事後条件の 2 か所とも関数のカタログに縛る(objid は別のカタログの oid と重なりうる)。
    expect(sql.split("d.classid = 'pg_proc'::regclass").length - 1).toBe(2);
    expect(sql).not.toContain('where d.objid = p.oid');
  });

  it('既存の関数の剥奪は種別を問わない routine で出す(手続き・集約も通る文)', () => {
    expect(sql).toContain("execute format('revoke all on routine %s from public, anon, authenticated', fn.signature);");
    expect(sql).not.toContain('revoke all on function %s');
  });

  it('新しい関数の既定の付与は作成主体ごとに、全体からもスキーマごとからも PUBLIC と面のロールの両方を外す', () => {
    // 実行した役も入る(設定の作成主体に無い役が migration を流しても、その役の既定は閉じる)。
    expect(sql).toContain("for creator in select distinct unnest(array['postgres', current_user::text]::text[]) loop");
    // 全体の既定: `in schema` を付けない。面のロールも外す(全体の付与はスキーマごとの剥奪で消えない)。
    expect(sql).toContain(
      "execute format('alter default privileges for role %I revoke execute on functions from public, anon, authenticated', creator);",
    );
    // スキーマごとの既定: `for role` を省かない。PUBLIC も外す(スキーマごとの PUBLIC への付与は全体の剥奪で消えない)。
    expect(sql).toContain("foreach schema_name in array array['public', 'api'] loop");
    expect(sql).toContain('if to_regnamespace(schema_name) is not null then');
    expect(sql).toContain(
      "execute format('alter default privileges for role %I in schema %I revoke execute on functions from public, anon, authenticated', creator, schema_name);",
    );
    expect(sql).not.toMatch(/alter default privileges in schema/u);
  });

  it('実在する必須の作成主体を扱えないときは止まる(通知で飛ばさない)。実在しない役だけ飛ばす', () => {
    expect(sql).toContain('if not exists (select 1 from pg_roles where rolname = creator) then');
    expect(sql).toContain("if not pg_has_role(current_user, creator::name, 'MEMBER') then");
    expect(sql).toMatch(/raise exception '[^']*', creator using errcode = '42501';/u);
    expect(sql).not.toContain('raise notice');
    // 実在の確認(continue)はメンバーの確認より前にあり、メンバーでない分岐の中には continue が無い。
    const notMember = sql.slice(sql.indexOf("if not pg_has_role(current_user, creator::name, 'MEMBER') then"));
    expect(notMember.slice(0, notMember.indexOf('end if;'))).not.toContain('continue');
  });

  it('外部の作成主体は、接続の役がメンバーのときだけ既定を外す（best-effort。メンバーでなければ触れず、止めない）', () => {
    expect(sql).toContain("for creator in select unnest(array['supabase_admin']::text[]) loop");
    expect(sql).toContain("and pg_has_role(current_user, creator::name, 'MEMBER') then");
    // 必須の役の繰り返しには入らない（実在するのに扱えなければ止まる経路は必須の役だけ）。
    expect(sql).toContain("array['postgres', current_user::text]");
    expect(sql).not.toContain("array['postgres', 'supabase_admin'");
    // 閉じられないことと理由をコメントに名指しする。
    expect(sql).toMatch(/^--   supabase_admin: .+$/mu);
    expect(sql).toContain('次の作成主体はプラットフォームが持つ役');
  });

  it('外部の作成主体が無ければ best-effort の繰り返しは出ない', () => {
    const none = { ...plan, externalCreators: [] };
    expect(buildGrantsMigration([], none)).not.toContain('best-effort');
    expect(buildGrantsMigration([], none)).not.toContain('メンバーでなければ触れない');
  });

  it('事後条件: 宣言の外の関数に面のロールか PUBLIC の実行権限が残れば、名指しして止める（fail closed）', () => {
    // 剥奪と同じ母集合（拡張が持つ関数と宣言した関数を除く）を ACL で見る。所有者への付与は数えない。
    expect(sql).toContain('aclexplode(coalesce(p.proacl, acldefault(\'f\', p.proowner)))');
    expect(sql).toContain("and a.privilege_type = 'EXECUTE'");
    expect(sql).toContain("(a.grantee = 0 or pg_get_userbyid(a.grantee)::text = any(array['anon', 'authenticated']::text[]))");
    expect(sql).toMatch(/raise exception '宣言の外の関数に面のロールか PUBLIC の実行権限が残っています[^']*', leftovers using errcode = '42501';/u);
    // 宣言した関数の除外は剥奪と事後条件の 2 か所に同じ形で出る。
    expect(sql.match(/where to_regprocedure\(declared\.identity\)::oid = p\.oid/gu)).toHaveLength(2);
  });

  it('外部の作成主体の理由に改行や SQL が混ざっても、コメントの外へは出ない', () => {
    const risky = {
      ...functionAclPlan({ model: DOMAIN, tables: TABLES, platform: TEST_PLATFORM }),
      externalCreators: [{ role: 'ext', reason: 'x\ndrop table t;\r\n$$ select 1' }],
    };
    const out = buildGrantsMigration([], risky);
    expect(out).toContain('--   ext: x drop table t; $$ select 1');
    expect(out.split('\n').filter((line) => /drop table/u.test(line) && !line.startsWith('--'))).toEqual([]);
    // 外部の役が無ければ前書きも出ない。
    expect(buildGrantsMigration([], { ...risky, externalCreators: [] })).not.toContain('次の作成主体はプラットフォームが持つ役');
  });

  it('計画を渡さなければ関数の節は出ない(表の権限だけの migration)', () => {
    const tablesOnly = buildGrantsMigration(grantPlans([], TEST_PLATFORM));
    expect(tablesOnly).not.toContain('pg_proc');
  });

  it('宣言した関数に grant は出さない(宛先を変えるのは自分の migration だけ)', () => {
    expect(sql).not.toMatch(/^\s*grant /mu);
  });
});

describe('呼べる側も必須の作成主体も空の計画(公開面の能力が無く、補助関数も無い構成)', () => {
  const unsupported = { ...TEST_PLATFORM, surfaceExposure: { kind: 'unsupported' as const, reason: '後段が公開面を外へ出さない構成' }, functionCreators: [] };
  const plan = functionAclPlan({ model: DOMAIN, tables: [], platform: unsupported });
  const sql = buildGrantsMigration([], plan);

  it('計画は空になる(この形の SQL を出す経路が実在する)', () => {
    expect(plan.callable).toEqual([]);
    expect(plan.requiredCreators).toEqual([]);
  });

  it('宣言の配列は空でも型の付いた形で出る(型の無い array[] は要素の型が決まらず、流す時点で止まる)', () => {
    expect(sql.match(/from unnest\(array\[\s*\]::text\[\]\) as declared\(identity\)/gu)).toHaveLength(2);
    expect(sql).not.toMatch(/array\[\s*\](?!::text\[\])/u);
  });

  it('作成主体の並びは接続の役だけになり、先頭の欠けた並び(array[, …])を出さない', () => {
    expect(sql).toContain('for creator in select distinct unnest(array[current_user::text]::text[]) loop');
    expect(sql).not.toMatch(/array\[\s*,/u);
  });
});

describe('別のプラットフォームの設定を渡すと(関数の節は設定の中身を知らない)', () => {
  const plan = functionAclPlan({ model: DOMAIN, tables: TABLES, platform: FOREIGN_PLATFORM });
  const sql = buildGrantsMigration(grantPlans([], FOREIGN_PLATFORM), plan);

  it('スキーマ・剥奪するロール・宣言する関数の名前が設定から引かれる', () => {
    expect(sql).toContain("where n.nspname in ('public', 'edge')");
    expect(sql).toContain("'edge.actor_id()'");
    expect(sql).toContain("array['builder', current_user::text]");
    expect(sql).toMatch(/^--   operator: /mu);
    expect(sql).toContain(
      'alter default privileges for role %I in schema %I revoke execute on functions from public, visitor, signed_in',
    );
    expect(sql).toContain("execute format('revoke all on routine %s from public, visitor, signed_in', fn.signature);");
  });

  it('Supabase の綴りが 1 つも残らない', () => {
    expect(leaksSupabaseSpelling(sql)).toBe(false);
    expect(leaksSupabaseSpelling(buildGrantsMigration([], functionAclPlan({ model: DOMAIN, tables: TABLES, platform: TEST_PLATFORM })))).toBe(true);
  });
});
