/**
 * sequence の権限の閉世界(`lib/sql/sequence-acl-migration.ts`。点検 3 回目 A3-6)のユニットテスト。
 *
 * 規約網羅(セキュリティ: 表の revoke は sequence に効かず、プラットフォームの既定は面のロールに usage / select / update を
 * 与える。`setval` で採番を巻き戻すと一意の衝突で妨害できる):
 *   - 計画のスキーマの全 sequence(拡張が持つものを除く)から PUBLIC と面のロールの権限を外す
 *   - 新しい sequence の既定の付与も、作成主体ごとに全体からもスキーマごとからも外す(必須の役を扱えなければ止まる)
 *   - 外部の作成主体はメンバーのときだけ閉じる(best-effort)
 *   - 事後条件: 面のロールか PUBLIC の権限が残れば名指しして止まる
 *   - 設定の中身を知らない(別の設定では綴りが全部変わる)
 */

import { describe, expect, it } from 'vitest';
import { functionAclPlan } from '../../../lib/sql/function-acl.js';
import { buildGrantsMigration, grantPlans } from '../../../lib/sql/grants-migration.js';
import { sequenceSection } from '../../../lib/sql/sequence-acl-migration.js';
import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_PLATFORM } from '../../helpers/platform.js';
import { specModel } from '../../helpers/model-builder-v8plus.js';

const PLAN = functionAclPlan({ model: specModel({ aggregates: [] }), tables: [], platform: TEST_PLATFORM });
const SQL = sequenceSection(PLAN).join('\n');

describe('sequence の権限の節', () => {
  it('計画のスキーマの全 sequence(relkind S・拡張が持つものを除く)から PUBLIC と面のロールの権限を外す', () => {
    expect(SQL).toContain("where c.relkind = 'S'");
    expect(SQL).toContain("and n.nspname in ('public', 'api')");
    expect(SQL).toContain("d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'");
    expect(SQL).toContain("execute format('revoke all on sequence %s from public, anon, authenticated', seq.name);");
  });

  it('新しい sequence の既定の付与を、作成主体ごとに全体からもスキーマごとからも外す', () => {
    expect(SQL).toContain("execute format('alter default privileges for role %I revoke all on sequences from public, anon, authenticated', creator);");
    expect(SQL).toContain(
      "execute format('alter default privileges for role %I in schema %I revoke all on sequences from public, anon, authenticated', creator, schema_name);",
    );
    expect(SQL).toContain("for creator in select distinct unnest(array['postgres', current_user::text]::text[]) loop");
  });

  it('実在する必須の作成主体を扱えないときは止まる(通知で飛ばさない)', () => {
    expect(SQL).toMatch(/if not pg_has_role\(current_user, creator::name, 'MEMBER'\) then\n\s+raise exception '[^']*sequence の既定の権限を外せないので止めます[^']*', creator using errcode = '42501';/u);
  });

  it('外部の作成主体はメンバーのときだけ閉じる(best-effort)', () => {
    expect(SQL).toContain("for creator in select unnest(array['supabase_admin']::text[]) loop");
    const none = sequenceSection({ ...PLAN, externalCreators: [] }).join('\n');
    expect(none).not.toContain('supabase_admin');
  });

  it('事後条件: 面のロールか PUBLIC の権限が残れば、名指しして止まる(既定の ACL も開いて見る)', () => {
    expect(SQL).toContain("cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a");
    expect(SQL).toContain("and (a.grantee = 0 or pg_get_userbyid(a.grantee)::text = any(array['anon', 'authenticated']::text[]))");
    expect(SQL).toMatch(/raise exception 'sequence に面のロールか PUBLIC の権限が残っています[^']*: %', leftovers using errcode = '42501';/u);
  });

  it('権限の migration では関数の節の後ろに出る(計画を渡したときだけ)', () => {
    const migration = buildGrantsMigration(grantPlans([], TEST_PLATFORM), PLAN);
    expect(migration.indexOf('sequence の権限の閉世界')).toBeGreaterThan(migration.indexOf('関数の実行権限の閉世界'));
    expect(buildGrantsMigration(grantPlans([], TEST_PLATFORM))).not.toContain('sequence');
  });
});

describe('別のプラットフォームの設定を渡すと(sequence の節は設定の中身を知らない)', () => {
  const foreign = sequenceSection(functionAclPlan({ model: specModel({ aggregates: [] }), tables: [], platform: FOREIGN_PLATFORM })).join('\n');

  it('スキーマ・剥奪するロール・作成主体が設定から引かれる', () => {
    expect(foreign).toContain("and n.nspname in ('public', 'edge')");
    expect(foreign).toContain('revoke all on sequence %s from public, visitor, signed_in');
    expect(foreign).toContain("array['builder', current_user::text]");
  });

  it('Supabase の綴りが 1 つも残らない', () => {
    expect(leaksSupabaseSpelling(foreign)).toBe(false);
  });
});
