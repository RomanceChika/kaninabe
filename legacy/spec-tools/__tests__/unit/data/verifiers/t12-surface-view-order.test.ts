/**
 * T12 のうち**surface のビューと RLS 補助関数の前後関係**のユニットテスト。
 *
 * 規約網羅(migrations.md §生成 migration / ARCH-SP-BE-0001 §テーブル仕様):
 *   - **隠し列を持つ表**の `surface_migration` の連番は、**どの RLS 補助関数の
 *     `migration` よりも後**(述語関数の `language sql` の本文が `public.is_{ロール}()` を
 *     呼ぶので、補助関数が無い DB では作成がその場で落ちる)
 *   - **隠し列を持たない表**は見ない(述語関数が 1 本も出ないので寄りかかっていない)
 *   - **補助関数を 1 つも宣言していない構成**でも 1 つも鳴らない
 *   - 基表の `ddl_migration` とも `policies_migration` とも比べない —— 要らない順序を
 *     規則にしない(理由は t12-surface-view-order.ts の §見ないもの)
 */

import { describe, expect, it } from 'vitest';
import { checkSurfaceViewOrder } from '../../../../lib/data/verifiers/t12-surface-view-order.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { accessSpec, fieldHiddenRule } from '../../../helpers/model-builder-v8plus.js';
import type { DataFunctionDecl, DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';

/** 補助関数 1 本の宣言(生成先つき)。 */
function helper(name: string, role: string, migration: string): DataFunctionDecl {
  return { name, args: [], params: [], kind: 'helper', role, migration, alsoWrites: [] };
}

/** 題材: 予約(booking)。隠し列を持つかどうかを切り替えられる。 */
function domain(masked: boolean): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }),
      access: accessSpec('booking', {
        fieldsHidden: masked ? [fieldHiddenRule('note', ['guest'])] : [],
      }),
    }),
  ]);
}

/** 予約の表(既定は補助関数より後に当たる健全な番号)。 */
function table(surfaceMigration = '20260912130101_api_view_bookings.sql'): DataTableSpec {
  return dataTable('bookings', {
    entity: 'booking',
    ddlMigration: '20260912120201_ddl_bookings.sql',
    surfaceMigration,
  });
}

/** 補助関数を 2 本持つ表(実行者の集約に相当)。 */
function users(): DataTableSpec {
  return dataTable('users', {
    entity: 'user',
    ddlMigration: '20260912120202_ddl_users.sql',
    functions: [
      helper('is_guest', 'guest', '20260912110001_helper_is_guest.sql'),
      helper('is_staff', 'staff', '20260912110002_helper_is_staff.sql'),
    ],
  });
}

/** 指摘の文面。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

describe('T12 面のビューと RLS 補助関数の前後関係', () => {
  it('補助関数より後に当たっていれば健全', () => {
    expect(checkSurfaceViewOrder(domain(true), dataTableModel([table(), users()]))).toEqual([]);
  });

  it('補助関数より前に当たったらエラー(一番後ろの補助関数を名指す)', () => {
    const findings = checkSurfaceViewOrder(
      domain(true),
      dataTableModel([table('20260912100001_api_view_bookings.sql'), users()]),
    );

    expect(messages(findings)).toEqual([
      'surface_migration 20260912100001_api_view_bookings.sql が RLS 補助関数 is_staff' +
        '(20260912110002_helper_is_staff.sql)より前に当たります' +
        '(この表は隠し列を持つので、面のビューの migration が述語関数を作ります)',
    ]);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location.pointer).toBe('surface_migration');
  });

  it('隠し列を持たない表は見ない(述語関数が 1 本も出ない)', () => {
    expect(
      checkSurfaceViewOrder(
        domain(false),
        dataTableModel([table('20260912100001_api_view_bookings.sql'), users()]),
      ),
    ).toEqual([]);
  });

  it('補助関数を 1 つも宣言していない構成では 1 つも鳴らない', () => {
    expect(
      checkSurfaceViewOrder(domain(true), dataTableModel([table('20260912100001_api_view_bookings.sql')])),
    ).toEqual([]);
  });

  it('基表の ddl_migration とは比べない(番号は表がいつ作られたかを表さない)', () => {
    const late = dataTable('bookings', {
      entity: 'booking',
      // 表の DDL は surface のビューより後の番号（題材の製品も現にこの形である）。
      ddlMigration: '20260912190201_ddl_bookings.sql',
      surfaceMigration: '20260912130101_api_view_bookings.sql',
    });
    expect(checkSurfaceViewOrder(domain(true), dataTableModel([late, users()]))).toEqual([]);
  });

  it('data_table を読めていなければ何も見ない', () => {
    expect(checkSurfaceViewOrder(domain(true), dataTableModel([table()], false))).toEqual([]);
  });
});
