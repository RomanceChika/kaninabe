/**
 * T12(表の DDL の出どころ)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様 / migrations.md §生成 migration):
 *   - `entity` を持つ表と `framework:` を宣言する表は `ddl_migration` が必須、
 *     設計図もドメイン仕様も持たない内部テーブルは宣言できない
 *   - `framework` は値域(jobs / domain_events)にあり、表の名前と一致する
 *   - SQL の公開面 surface の判定(`surface_base_migration` / `surface_migration` / `hand_written_views`)は
 *     同じ T12 だが、テストは t12-surface-views.test.ts が持つ
 *   - 名前は `{14 桁}_ddl_{テーブル名}.sql`
 *   - 名前は全 data_table を通して一意(`policies_migration` / `functions[].migration` とも衝突しない)
 *   - **生成の前提**(entity_spec が引ける)—— 生成器が `preconditionFailure('T12')` で
 *     宣言する前提を、verify の段で落とす
 *   - data_table を置いていないリポジトリでは何も見ない
 */

import { describe, expect, it } from 'vitest';
import { verifyDdlMigration } from '../../../../lib/data/verifiers/t12-ddl-migration.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import type { SurfaceSpecModel } from '../../../../lib/model/surface/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { surfacePlatform } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 題材: 予約(booking)。 */
const domain: SpecModel = specModel([
  aggregate('booking', { entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }) }),
]);

/** 宣言を「落とす」ことを `null` で書ける形(T6 / T7 のテストと同じ流儀)。 */
type TableOverrides = Omit<Partial<DataTableSpec>, 'ddlMigration'> & {
  readonly ddlMigration?: string | null;
};

/** 予約の表(既定は健全な宣言つき)。 */
function table(overrides: TableOverrides = {}): DataTableSpec {
  const { ddlMigration: declared, ...rest } = overrides;
  const migration = declared === undefined ? '20260912120201_ddl_bookings.sql' : declared;
  return dataTable('bookings', {
    entity: 'booking',
    ...rest,
    ...(migration === null ? {} : { ddlMigration: migration }),
  });
}

/**
 * 健全な surface_spec(権限の書き出し先を宣言する)。
 *
 * `grants_migration` は表を 1 枚でも持つ系では必須なので、表の DDL の判定を見るテストでも
 * 宣言させておく —— 宣言が無いときの指摘そのものは t12-grants.test.ts が実行する。
 */
const surface: SurfaceSpecModel = {
  available: true,
  spec: {
    id: 'surface',
    grantsMigration: '20260912129999_grants.sql',
    handWrittenViews: [],
    location: { file: 'docs/specs/backend/surface.md' },
  },
};

/** 表の DDL の判定を実行する(surface の宣言は健全なものを渡す)。 */
function verify(dataTables: DataTableSpecModel) {
  return verifyDdlMigration(domain, dataTables, TEST_ROOTS, surfacePlatform(), undefined, undefined, surface);
}

/** 指摘の文面。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

describe('T12 表の DDL の出どころ', () => {
  it('宣言が揃っていれば健全', () => {
    expect(verify(dataTableModel([table()]))).toEqual([]);
  });

  it('entity を持つ表に宣言が無ければエラー', () => {
    const found = verify(dataTableModel([table({ ddlMigration: null })]));
    expect(messages(found)).toEqual(['bookings は形が導ける表ですが ddl_migration の宣言がありません']);
  });

  it('設計図を宣言しない内部テーブルが宣言していたらエラー', () => {
    const notes = dataTable('audit_notes', { internal: true, ddlMigration: '20260912120209_ddl_audit_notes.sql' });
    const found = verify(dataTableModel([table(), notes]));
    expect(messages(found)).toEqual([
      'audit_notes は形の正がどこにも無い表なので ddl_migration を宣言できません',
    ]);
  });

  it('設計図を宣言しない内部テーブルが宣言していなければ健全(必須ではない)', () => {
    const notes = dataTable('audit_notes', { internal: true });
    expect(verify(dataTableModel([table(), notes]))).toEqual([]);
  });

  it('framework 表は ddl_migration が必須で、宣言があれば健全', () => {
    const jobs = dataTable('jobs', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_jobs.sql',
    });
    expect(verify(dataTableModel([table(), jobs]))).toEqual([]);
    const bare = dataTable('jobs', { internal: true, framework: 'jobs' });
    expect(messages(verify(dataTableModel([table(), bare])))).toEqual([
      'jobs は形が導ける表ですが ddl_migration の宣言がありません',
    ]);
  });

  it('framework が値域に無ければエラー', () => {
    const outbox = dataTable('outbox', {
      internal: true,
      framework: 'queue',
      ddlMigration: '20260912120209_ddl_outbox.sql',
    });
    expect(messages(verify(dataTableModel([table(), outbox])))).toContain(
      'framework queue に対応する設計図がありません',
    );
  });

  it('framework が表の名前と食い違えばエラー', () => {
    const outbox = dataTable('outbox', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_outbox.sql',
    });
    expect(messages(verify(dataTableModel([table(), outbox])))).toContain(
      'framework jobs が表の名前 outbox と一致しません',
    );
  });

  it('名前が {14 桁}_ddl_{テーブル名}.sql でなければエラー', () => {
    const found = verify(dataTableModel([table({ ddlMigration: 'ddl_bookings.sql' })]));
    expect(messages(found)).toEqual([
      'ddl_migration ddl_bookings.sql が表 bookings から導かれる名前になっていません',
    ]);
  });

  it('連番が 14 桁でなければエラー(境界)', () => {
    const found = verify(dataTableModel([table({ ddlMigration: '2026091212020_ddl_bookings.sql' })]));
    expect(messages(found)).toEqual([
      'ddl_migration 2026091212020_ddl_bookings.sql が表 bookings から導かれる名前になっていません',
    ]);
  });

  it('policies_migration と名前が衝突したらエラー', () => {
    const found = verify(dataTableModel([table({ policiesMigration: '20260912120201_ddl_bookings.sql' })]));
    expect(messages(found)).toEqual([
      'ddl_migration 20260912120201_ddl_bookings.sql が table bookings の policies_migration と重複しています',
    ]);
  });

  it('entity_spec が引けなければエラー(生成器の前提)', () => {
    const found = verify(dataTableModel([table({ entity: 'unknown' })]));
    expect(messages(found)).toEqual(['bookings の entity unknown に対応する entity_spec がありません']);
  });

  it('data_table を置いていないリポジトリでは何も見ない', () => {
    expect(verify(dataTableModel([], false))).toEqual([]);
  });
});
