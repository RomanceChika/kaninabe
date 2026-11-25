/**
 * T12 のうち**表の権限の出どころ**(surface_spec の `grants_migration`)のユニットテスト。
 *
 * 規約網羅(surface-spec-writing.md / ARCH-SP-BE-0001 §テーブル仕様):
 *   - 表を 1 枚でも持つ系では**必須**(surface_spec を置いていないリポジトリでも鳴る ——
 *     宣言が無ければ誰も `revoke` / `grant` を出さないまま全部緑で成立する)
 *   - 名前は `{14 桁}_grants.sql`(系に 1 本なので後ろに対象の名前が付かない)
 *   - 全 migration 名を通して一意
 *   - **連番の前後は見ない**(表ごとの権限は存在ガードつきで出るので、表の DDL との前後関係を
 *     持たない。番号で保証していたあいだ、表の DDL の再発行ごとにバイト同一の migration が
 *     1 本増えていた —— 2026-09-26)
 *   - 表が 1 枚も無い / data_table を置いていない系では何も見ない
 */

import { describe, expect, it } from 'vitest';
import { verifyDdlMigration } from '../../../../lib/data/verifiers/t12-ddl-migration.js';
import type { SurfaceSpecModel } from '../../../../lib/model/surface/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { surfacePlatform } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 仕様ファイルの位置(Finding 用)。 */
const AT = { file: 'docs/specs/backend/surface.md' } as const;

/** 題材: 予約(booking)。 */
const domain: SpecModel = specModel([
  aggregate('booking', { entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }) }),
]);

/** 予約の表(表の DDL は 20260912120201)。 */
function table(overrides: Partial<DataTableSpec> = {}): DataTableSpec {
  return dataTable('bookings', {
    entity: 'booking',
    ddlMigration: '20260912120201_ddl_bookings.sql',
    ...overrides,
  });
}

/** surface_spec のモデル(`grants` を省くと「宣言しない」構成になる)。 */
function surfaceModel(grants?: string): SurfaceSpecModel {
  return {
    available: true,
    spec: {
      id: 'surface',
      ...(grants === undefined ? {} : { grantsMigration: grants }),
      handWrittenViews: [],
      location: AT,
    },
  };
}

/** 権限の判定だけを取り出す(表の DDL 側の指摘と混ぜない)。 */
function grantsFindings(tables: readonly DataTableSpec[], surface: SurfaceSpecModel) {
  return verifyDdlMigration(domain, dataTableModel(tables), TEST_ROOTS, surfacePlatform(), undefined, undefined, surface)
    .filter((finding) => finding.location.pointer === 'grants_migration')
    .map((finding) => finding.message);
}

describe('T12 表の権限の出どころ', () => {
  it('宣言が揃っていれば健全', () => {
    expect(grantsFindings([table()], surfaceModel('20260912120400_grants.sql'))).toEqual([]);
  });

  it('表があるのに宣言が無ければエラー(免除の口を持たない)', () => {
    expect(grantsFindings([table()], surfaceModel())).toEqual([
      '表が 1 枚あるのに surface_spec の grants_migration の宣言がありません',
    ]);
  });

  it('surface_spec を置いていないリポジトリでも鳴る(置かないことが逃げ道にならない)', () => {
    const missing: SurfaceSpecModel = { available: false, spec: null };
    expect(grantsFindings([table()], missing)).toEqual([
      '表が 1 枚あるのに surface_spec の grants_migration の宣言がありません',
    ]);
  });

  it('名前が {14 桁}_grants.sql でなければエラー', () => {
    expect(grantsFindings([table()], surfaceModel('20260912120400_grants_all.sql'))).toEqual([
      'grants_migration 20260912120400_grants_all.sql が決まった名前になっていません',
    ]);
  });

  it('連番が 14 桁でなければエラー(境界)', () => {
    expect(grantsFindings([table()], surfaceModel('2026091212040_grants.sql'))).toEqual([
      'grants_migration 2026091212040_grants.sql が決まった名前になっていません',
    ]);
  });

  it('**表の DDL より前の番号でも通る**(前後関係は存在ガードが持つ。2026-09-26)', () => {
    // 表の DDL は 20260912120201 だが、権限はその前でも後でもよい ——
    // 表の DDL を 1 枚再発行しただけで権限の採番をやり直さないため。
    expect(grantsFindings([table()], surfaceModel('20260912120100_grants.sql'))).toEqual([]);
    expect(grantsFindings([table()], surfaceModel('20260912120201_grants.sql'))).toEqual([]);
    const other = dataTable('rooms', { entity: 'booking', ddlMigration: '20260912120209_ddl_rooms.sql' });
    expect(grantsFindings([table(), other], surfaceModel('20260912120100_grants.sql'))).toEqual([]);
  });

  it('ほかの生成物と名前が衝突したらエラー', () => {
    const clash = table({ policiesMigration: '20260912120400_grants.sql' });
    expect(grantsFindings([clash], surfaceModel('20260912120400_grants.sql'))).toEqual([
      'grants_migration 20260912120400_grants.sql が table bookings の policies_migration と重複しています',
    ]);
  });

  it('表が 1 枚も無い / data_table を置いていない系では何も見ない', () => {
    expect(grantsFindings([], surfaceModel())).toEqual([]);
    expect(
      verifyDdlMigration(domain, dataTableModel([], false), TEST_ROOTS, surfacePlatform(), undefined, undefined, surfaceModel()),
    ).toEqual([]);
  });
});
