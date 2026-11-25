/**
 * 表の ACL の全数(`lib/sql/table-acl.ts`)のユニットテスト。
 *
 * 規約網羅(design/ddl-generation.md §表の ACL / ARCH-SP-BE-0001 §テーブル仕様):
 *   - 特権ロール(`service_role`)はどの表でも同じ 4 権限だけを持つ
 *     (`truncate` / `references` / `trigger` / `maintain` は持たない)
 *   - surface のロールは **`reads` が `grant select` を要求する宛先だけ**が `select` を持つ
 *   - 読めないロールも**空の配列で載る** —— 閉世界なので「持たない」ことが宣言である
 *   - 仕組みが自分で持つ表(`access_spec` を持たない)は surface のロールが 1 つも権限を持たない
 *   - 刈り込まれたポリシーの宛先は消えない(刈り込みは行集合の話であって権限の話ではない)
 */

import { FOREIGN_PLATFORM, TEST_PLATFORM } from '../../helpers/platform.js';
import { describe, expect, it } from 'vitest';
import { aclRoles, tableAcl } from '../../../lib/sql/table-acl.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, entitySpec, read, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import type { ReadRule } from '../../../lib/model/types.js';

/** 題材のロール(未ログイン / 既定 / 内部実行 / claim / 対象との関係)。 */
const roles = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('member', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
  { ...role('staff', undefined, ['member']), claim: 'member.is_staff' },
  role('performer', 'entry.performer_id == actor.id', ['member']),
]);

/** その `reads` を持つ集約 1 つぶんのモデル。 */
function model(reads: readonly ReadRule[]) {
  return specModel(
    [
      aggregate('entry', {
        entity: entitySpec('entry', { fields: [] }),
        access: accessSpec('entry', { reads }),
      }),
    ],
    roles,
  );
}

/** ロール → 権限の対応表にする(並びは `aclRoles` 固定なので中身だけを見る)。 */
function aclOf(reads: readonly ReadRule[], entity: string | null = 'entry') {
  const table = dataTable('entries', entity === null ? {} : { entity });
  return Object.fromEntries(tableAcl(table, model(reads), TEST_PLATFORM).map((entry) => [entry.role, entry.privileges]));
}

describe('表の ACL の全数', () => {
  it('閉世界に載るのは面の 2 ロールと特権ロールである(所有者は載らない)', () => {
    expect(aclRoles(TEST_PLATFORM)).toEqual(['anon', 'authenticated', 'service_role']);
    expect(tableAcl(dataTable('entries', { entity: 'entry' }), model([]), TEST_PLATFORM).map((entry) => entry.role)).toEqual(
      aclRoles(TEST_PLATFORM),
    );
  });

  it('特権ロールは 4 権限だけを持つ(truncate は持たない)', () => {
    expect(aclOf([read('member', 'all')])['service_role']).toEqual(['select', 'insert', 'update', 'delete']);
  });

  it('reads が要求する宛先だけが select を持ち、ほかは空で載る', () => {
    // `member` は authenticated 宛。未ログインの読みが無いので anon は何も持たない。
    expect(aclOf([read('member', 'all')])).toEqual({
      anon: [],
      authenticated: ['select'],
      service_role: ['select', 'insert', 'update', 'delete'],
    });
  });

  it('未ログインが読める表では anon にも select が付く', () => {
    expect(aclOf([read('anonymous', 'all'), read('member', 'all')])['anon']).toEqual(['select']);
  });

  it('scope: none と内部実行ロールだけの表では surface のロールが何も持たない', () => {
    expect(aclOf([read('member', 'none'), read('system', 'all')])).toEqual({
      anon: [],
      authenticated: [],
      service_role: ['select', 'insert', 'update', 'delete'],
    });
  });

  it('刈り込まれたロールの宛先は消えない(刈り込みは行集合の話である)', () => {
    // `performer` の own は `member` の all に包含されてポリシーが消えるが、どちらも
    // 宛先は `authenticated` なので権限は変わらない。
    expect(aclOf([read('member', 'all'), read('performer', 'own')])['authenticated']).toEqual(['select']);
  });

  it('access_spec を引けない表(仕組みが自分で持つ表)では surface のロールが何も持たない', () => {
    expect(aclOf([read('member', 'all')], null)).toEqual({
      anon: [],
      authenticated: [],
      service_role: ['select', 'insert', 'update', 'delete'],
    });
  });
});

describe('別のプラットフォームの設定を渡すと(ACL のロール名は設定から引く)', () => {
  it('閉世界のロールの並びと、読める宛先の写像が設定の名前になる', () => {
    expect(aclRoles(FOREIGN_PLATFORM)).toEqual(['visitor', 'signed_in', 'worker']);
    const table = dataTable('entries', { entity: 'entry' });
    const acl = Object.fromEntries(tableAcl(table, model([read('member', 'all')]), FOREIGN_PLATFORM).map((entry) => [entry.role, entry.privileges]));
    expect(acl['signed_in']).toEqual(['select']);
    expect(acl['visitor']).toEqual([]);
    expect(acl['worker']).toEqual(['select', 'insert', 'update', 'delete']);
  });
});
