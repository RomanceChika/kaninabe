/**
 * T12 のうち**SQL の公開面(surface)**(surface_spec の宣言と `surface_migration`)のユニットテスト。
 *
 * 規約網羅(surface-spec-writing.md / ARCH-SP-BE-0001 §テーブル仕様):
 *   - `surface_base_migration` は surface_spec が `{14 桁}_{公開スキーマ}_base.sql` の名前で宣言する
 *   - **宣言する場合は**、連番が **公開スキーマに関数・ビューを作る生成 migration すべてより前**
 *     (定型 RPC・補助関数・ポリシー・surface のビュー・保存点の複合 RPC・受信の RPC)。相手は一番早い
 *     1 本だけを名指す。宣言しない構成では 1 つも鳴らない
 *   - surface に出る表(entity_spec と access_spec の両方を持つ)は `surface_migration` が必須で、
 *     名前は `{14 桁}_{公開スキーマ}_view_{テーブル名}.sql`(公開スキーマは `exposedSchema`)、全 migration 名を通して一意
 *   - 名前の規則は置き場の実在に依らず**いつも**効く(適用済みかどうかを機械が推測しない)。食い違いの対処は
 *     「新しい migration なら直す / 適用済みの公開スキーマを改名したなら未対応」の両方を名指す
 *   - 後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)では、公開面の判定を行わない
 *   - surface に出ない表は `surface_migration` を宣言できない
 *   - `hand_written_views` に宣言できるのは `internal: true` の data_table だけ(免除の口にしない)
 */

import { describe, expect, it } from 'vitest';
import { verifyDdlMigration } from '../../../../lib/data/verifiers/t12-ddl-migration.js';
import type { HandWrittenViewDecl, SurfaceSpecModel } from '../../../../lib/model/surface/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { accessSpec } from '../../../helpers/model-builder-v8plus.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { UsecaseSpecModel } from '../../../../lib/model/usecase/types.js';
import { FOREIGN_PLATFORM, surfacePlatform, TEST_PLATFORM } from '../../../helpers/platform.js';
import type { SurfacePlatform } from '../../../../lib/data/verifiers/t12-surface-naming.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 仕様ファイルの位置(Finding 用)。 */
const AT = { file: 'docs/specs/backend/surface.md' } as const;

/** 題材: 予約(booking)。surface に出る表(entity_spec と access_spec の両方がある)。 */
const domain: SpecModel = specModel([
  aggregate('booking', {
    entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }),
    access: accessSpec('booking'),
  }),
]);

/** 予約の表(既定は surface の宣言まで健全)。 */
function table(overrides: Partial<DataTableSpec> = {}): DataTableSpec {
  return dataTable('bookings', {
    entity: 'booking',
    ddlMigration: '20260912120201_ddl_bookings.sql',
    surfaceMigration: '20260912120301_api_view_bookings.sql',
    ...overrides,
  });
}

/** surface_spec のモデル(既定は宣言なし = surface を手書きの migration が持つ構成)。 */
function surfaceModel(
  init: { readonly base?: string; readonly handWritten?: readonly string[] } = {},
): SurfaceSpecModel {
  const handWrittenViews: readonly HandWrittenViewDecl[] = (init.handWritten ?? []).map((name) => ({
    table: name,
    reason: '内部テーブルで列の正が仕様に無い',
    location: AT,
  }));
  return {
    available: true,
    spec: {
      id: 'surface',
      ...(init.base === undefined ? {} : { surfaceBaseMigration: init.base }),
      // 権限の書き出し先は表を 1 枚でも持つ系では必須なので、surface の判定を見るテストでも
      // 宣言させておく(宣言が無いときの指摘は t12-grants.test.ts が実行する)。
      grantsMigration: '20260912129999_grants.sql',
      handWrittenViews,
      location: AT,
    },
  };
}

/** 保存点の複合 RPC を 1 本だけ持つ usecase_spec のモデル(公開スキーマの土台の順序の相手)。 */
function usecaseModel(migration: string): UsecaseSpecModel {
  return {
    available: true,
    usecases: [
      {
        id: 'usecase-book-room',
        usecase: 'book_room',
        saves: [{ id: 'reserve', migration }],
      } as unknown as UsecaseSpecModel['usecases'][number],
    ],
  };
}

/** 指摘の文面。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

/** T12 を surface の入力つきで回す(公開面の判定が読む構成の既定は Supabase の設定)。 */
function verify(
  tables: readonly DataTableSpec[],
  surface: SurfaceSpecModel = surfaceModel(),
  usecases?: UsecaseSpecModel,
  platform: SurfacePlatform = surfacePlatform(),
): readonly { readonly message: string; readonly severity: string }[] {
  return verifyDdlMigration(domain, dataTableModel(tables), TEST_ROOTS, platform, usecases, undefined, surface);
}

describe('T12 SQL の公開面(surface)の出どころ', () => {
  it('宣言が揃っていれば健全', () => {
    expect(verify([table()])).toEqual([]);
  });

  it('surface に出る表に surface_migration が無ければエラー', () => {
    const bare = dataTable('bookings', { entity: 'booking', ddlMigration: '20260912120201_ddl_bookings.sql' });
    expect(messages(verify([bare]))).toEqual([
      'bookings は surface に出る表なのに surface_migration がありません',
    ]);
  });

  it('名前が {14 桁}_{公開スキーマ}_view_{テーブル名}.sql でなければエラー', () => {
    expect(messages(verify([table({ surfaceMigration: 'api_view_bookings.sql' })]))).toEqual([
      'surface_migration api_view_bookings.sql が決まった名前になっていません',
    ]);
  });

  it('列の正がどこにも無い表は surface_migration を宣言できない', () => {
    // entity_spec も設計図(framework)も無い内部テーブル —— ビューの列を導く手がかりが無い。
    const cache = dataTable('tutorial_docs', {
      internal: true,
      ddlMigration: '20260912120209_ddl_tutorial_docs.sql',
      surfaceMigration: '20260912120302_api_view_tutorial_docs.sql',
    });
    expect(messages(verify([table(), cache]))).toContain(
      'tutorial_docs は surface に出る表ではないので surface_migration を宣言できません',
    );
  });

  it('仕組みが自分で持つ表(framework)は宣言してよいが、必須ではない', () => {
    const declared = dataTable('jobs', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_jobs.sql',
      surfaceMigration: '20260912120302_api_view_jobs.sql',
    });
    const silent = dataTable('jobs', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_jobs.sql',
    });
    // 列の正は設計図にあるので導ける（宣言すれば生成物になる）。
    expect(verify([table(), declared])).toEqual([]);
    // その表を surface に出すかどうかは仕様に現れない実装事情なので、宣言しないことも許す。
    expect(verify([table(), silent])).toEqual([]);
  });

  it('surface_migration がほかの生成 migration と衝突したらエラー', () => {
    const clash = table({ surfaceMigration: '20260912120201_ddl_bookings.sql' });
    expect(messages(verify([clash]))).toContain(
      'surface_migration 20260912120201_ddl_bookings.sql が table bookings と重複しています',
    );
  });

  it('surface_base_migration は正しい名前で宣言する', () => {
    expect(verify([table()], surfaceModel({ base: '20260911000000_api_base.sql' }))).toEqual([]);
    expect(messages(verify([table()], surfaceModel({ base: 'api_base.sql' })))).toEqual([
      'surface_base_migration api_base.sql が決まった名前になっていません',
    ]);
  });

  it('surface_base_migration が公開スキーマに関数・ビューを作る生成 migration より後ならエラー', () => {
    // surface のビューも土台より後でなければ当たらないので、順序の相手として数える。
    const host = table({
      surfaceMigration: '20260910000000_api_view_bookings.sql',
      functions: [
        {
          name: 'insert_booking',
          args: ['jsonb'],
          params: ['p_values'],
          kind: 'rpc',
          shape: 'create',
          migration: '20260912100002_rpc_insert_booking.sql',
          alsoWrites: [],
        },
      ],
    });
    const usecases = usecaseModel('20260911000001_usecase_book_room_reserve.sql');
    // 相手は一番早い 1 本だけを名指し、件数を添える(直し方は 1 つなので全部は並べない)。
    expect(
      verify([host], surfaceModel({ base: '20260912120210_api_base.sql' }), usecases).map(
        (finding) => `${finding.severity} ${finding.message}`,
      ),
    ).toEqual([
      'error surface_base_migration 20260912120210_api_base.sql が ' +
        '20260910000000_api_view_bookings.sql(table bookings の surface_migration)' +
        'より後に当たります(公開スキーマに関数・ビューを作る生成 migration 3 本より後)',
    ]);
    // 土台が全部より先なら健全。
    expect(verify([table()], surfaceModel({ base: '20260909000000_api_base.sql' }), usecases)).toEqual([]);
  });

  it('surface_base_migration を宣言しない構成では順序も形も見られない', () => {
    const host = table({
      functions: [
        {
          name: 'insert_booking',
          args: ['jsonb'],
          params: ['p_values'],
          kind: 'rpc',
          shape: 'create',
          migration: '20260912100002_rpc_insert_booking.sql',
          alsoWrites: [],
        },
      ],
    });
    expect(verify([host], surfaceModel(), usecaseModel('20260911000001_usecase_x.sql'))).toEqual([]);
  });

  it('hand_written_views に宣言できるのは内部テーブルだけ', () => {
    const jobs = dataTable('jobs', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_jobs.sql',
    });
    expect(verify([table(), jobs], surfaceModel({ handWritten: ['jobs'] }))).toEqual([]);
    expect(messages(verify([table(), jobs], surfaceModel({ handWritten: ['bookings'] })))).toEqual([
      'hand_written_views に bookings は宣言できません(内部テーブルではありません)',
    ]);
    expect(messages(verify([table(), jobs], surfaceModel({ handWritten: ['queue'] })))).toEqual([
      'hand_written_views の queue に対応する data_table がありません',
    ]);
  });

  it('同じ表が hand_written_views と surface_migration の両方を宣言したらエラー', () => {
    const generated = dataTable('jobs', {
      internal: true,
      framework: 'jobs',
      ddlMigration: '20260912120209_ddl_jobs.sql',
      surfaceMigration: '20260912120302_api_view_jobs.sql',
    });
    expect(messages(verify([table(), generated], surfaceModel({ handWritten: ['jobs'] })))).toEqual([
      'hand_written_views の jobs は surface_migration も宣言しています',
    ]);
  });

  it('surface_spec を置いていないリポジトリでは面の判定を 1 つも行わない', () => {
    const bare = dataTable('bookings', { entity: 'booking', ddlMigration: '20260912120201_ddl_bookings.sql' });
    // surface の仕様書が無くても surface_migration の必須は効く(surface に出る表は仕様から決まるため)。
    // ここで見たいのは「surface_spec 由来の判定(土台・手書き)が鳴らない」ことである。
    expect(
      messages(verifyDdlMigration(domain, dataTableModel([bare]), TEST_ROOTS, surfacePlatform(), undefined, undefined, surfaceModel())),
    ).toEqual(['bookings は surface に出る表なのに surface_migration がありません']);
  });
});

describe('T12 公開面の名前の規則: 公開スキーマは exposedSchema から導き、いつも照らす', () => {
  const edge = surfacePlatform(FOREIGN_PLATFORM);

  it('exposedSchema が違えば、期待する綴りも変わる(固定の api を持たない)', () => {
    const edgeNamed = table({ surfaceMigration: '20260912120301_edge_view_bookings.sql' });
    expect(verify([edgeNamed], surfaceModel(), undefined, edge)).toEqual([]);
    expect(messages(verify([table()], surfaceModel(), undefined, edge))).toEqual([
      'surface_migration 20260912120301_api_view_bookings.sql が決まった名前になっていません',
    ]);
    expect(verify([edgeNamed], surfaceModel({ base: '20260911000000_edge_base.sql' }), undefined, edge)).toEqual([]);
    expect(messages(verify([edgeNamed], surfaceModel({ base: '20260911000000_api_base.sql' }), undefined, edge))).toEqual([
      'surface_base_migration 20260911000000_api_base.sql が決まった名前になっていません',
    ]);
  });

  it('規則に合わない名前は、置き場の実在に依らずいつも error(適用済みかどうかを推測して免除しない)', () => {
    // 判定は宣言の名前だけで決まる。置き場に同名のファイルがあっても(生成が先に書いても)結果は変わらない。
    const wrong = table({ surfaceMigration: '20260912120301_legacy_naming_bookings.sql' });
    expect(messages(verify([wrong]))).toEqual(['surface_migration 20260912120301_legacy_naming_bookings.sql が決まった名前になっていません']);
    const wrongBase = surfaceModel({ base: '20260911000000_public_api_base.sql' });
    expect(messages(verify([table()], wrongBase))).toEqual(['surface_base_migration 20260911000000_public_api_base.sql が決まった名前になっていません']);
  });

  it('合う名前は緑(Supabase の歴史は api のまま差分 0)', () => {
    expect(verify([table()], surfaceModel({ base: '20260911000000_api_base.sql' }))).toEqual([]);
  });

  it('exposedSchema を変えた構成では、api の名前が全部 error になり、対処は 2 つの場合(新しい migration / 適用済みの改名 = 未対応)を名指す', () => {
    const findings = verify([table()], surfaceModel({ base: '20260911000000_api_base.sql' }), undefined, edge);
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding).toMatchObject({ severity: 'error' });
      const suggestion = (finding as { suggestion?: string }).suggestion ?? '';
      expect(suggestion).toContain('新しい migration なら');
      expect(suggestion).toContain('未対応');
    }
  });

  it('旧いキー api_view_migration が書かれた表には「surface_migration がありません」を重ねない(パーサの廃止の error が 1 つの原因を言う)', () => {
    const bare = dataTable('bookings', { entity: 'booking', ddlMigration: '20260912120201_ddl_bookings.sql', retiredSurfaceKey: true });
    expect(verify([bare])).toEqual([]);
  });
});

describe('T12 公開面: 後段が SQL の公開面を API として外へ出す能力を持たない構成', () => {
  const unsupported = surfacePlatform({
    ...TEST_PLATFORM,
    surfaceExposure: { kind: 'unsupported', reason: '権限が SQL の外にある API 層' },
  });

  it('公開面の判定(ビューの必須・土台・権限)を行わない(未対応の報告は実行口が言う)', () => {
    const bare = dataTable('bookings', { entity: 'booking', ddlMigration: '20260912120201_ddl_bookings.sql' });
    // 能力のある構成なら surface_migration の必須が鳴る同じ入力が、鳴らない。
    expect(messages(verify([bare]))).toEqual(['bookings は surface に出る表なのに surface_migration がありません']);
    expect(verify([bare], surfaceModel({ base: 'broken.sql' }), undefined, unsupported)).toEqual([]);
  });

  it('公開面の外の判定(表の DDL の出どころ)は能力に依らず見る', () => {
    const noDdl = dataTable('bookings', { entity: 'booking' });
    expect(messages(verify([noDdl], surfaceModel(), undefined, unsupported))).toEqual([
      'bookings は形が導ける表ですが ddl_migration の宣言がありません',
    ]);
  });
});
