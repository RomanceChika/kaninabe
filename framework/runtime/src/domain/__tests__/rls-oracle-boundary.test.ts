/**
 * RLS のオラクル(`@kaninabe/runtime/testing/rls/oracle`)が**境界(`reads[].filters`)を実行者の行で判定し、
 * 親の列なら参照の鎖を辿る**ことの単体テスト。実 DB は使わない(固定した world のリテラルを渡す)。
 *
 * 見るのは 3 点である。
 *   1. 親の列の境界(`via` が 1 本以上)は、的の行から参照列を辿った先の行の列で比べる
 *   2. 比べる相手は**実行者自身の行の欄**であり、セッションの写し(`claims`)ではない —— 写しが古くても
 *      (所属を付け替えたあとのトークン)、期待は行の値に従う。生成するポリシーも同じ正を読む
 *   3. 辿った先の行が無ければ見せない(ポリシーのスカラー副問い合わせが NULL を返すのと同じ)
 *
 * ロール ID・集約名は仮の語である(オラクルは設計図の語しか知らない)。
 */

import { describe, expect, it } from 'vitest';
import { boundaryValue, oracleVisibility } from '@kaninabe/runtime/testing/rls/oracle';
import type { RlsWorld, RlsWorldRole } from '@kaninabe/runtime/testing/rls/types';
import type { BuiltRlsActor, BuiltRlsRow, BuiltRlsWorld } from '@kaninabe/runtime/testing/rls/world';

/** ロールの根拠(既定のログインロールだけ)。 */
const ROLES: readonly RlsWorldRole[] = [
  { id: 'member', anonymous: false, system: false, authenticatedDefault: true, claimField: null, binding: null, implies: [] },
];

/** 予約(booking)→ 部門(department)。部門だけが会社の列を持つ。実行者は person。 */
const WORLD: RlsWorld = {
  table: 'bookings',
  entity: 'booking',
  actorTable: 'people',
  actors: [
    { key: 'a', role: 'member', anonymous: false, row: 'a:person' },
    { key: 'b', role: 'member', anonymous: false, row: 'b:person' },
  ],
  rows: ['a', 'b'].flatMap((key) => [
    { key: `${key}:person`, table: 'people', entity: 'person', values: {}, refs: {}, actor: key, ancestry: {} },
    { key: `${key}:department`, table: 'departments', entity: 'department', values: {}, refs: {}, actor: null, ancestry: {} },
    { key: `${key}:booking`, table: 'bookings', entity: 'booking', values: {}, refs: {}, actor: null, ancestry: {} },
  ]),
  targets: ['a:booking', 'b:booking'],
  reads: [
    {
      by: 'member',
      scope: 'all',
      filters: [{ field: 'company_id', actorField: 'company_id', via: ['department_id'] }],
      when: null,
    },
  ],
};

/** 実 DB に作った world(`stale` なら、a のセッションの写しは付け替える前の会社のまま)。 */
function built(options: { readonly stale?: boolean; readonly orphan?: boolean } = {}): BuiltRlsWorld {
  const rows: BuiltRlsRow[] = ['a', 'b'].flatMap((key) => [
    { key: `${key}:person`, table: 'people', entity: 'person', id: `person-${key}`, values: { id: `person-${key}`, company_id: `company-${key}` } },
    { key: `${key}:department`, table: 'departments', entity: 'department', id: `department-${key}`, values: { id: `department-${key}`, company_id: `company-${key}` } },
    {
      key: `${key}:booking`,
      table: 'bookings',
      entity: 'booking',
      id: `booking-${key}`,
      values: { id: `booking-${key}`, department_id: options.orphan === true && key === 'a' ? 'department-gone' : `department-${key}` },
    },
  ]);
  const actors: BuiltRlsActor[] = ['a', 'b'].map((key) => ({
    key,
    id: `person-${key}`,
    token: 't',
    // 写しが古い: a の行は会社 a だが、トークンには会社 b が載ったまま。
    claims: { company_id: options.stale === true && key === 'a' ? 'company-b' : `company-${key}` },
  }));
  return { rows: new Map(rows.map((row) => [row.key, row])), actors: new Map(actors.map((actor) => [actor.key, actor])) };
}

describe('RLS のオラクル — 境界(実行者の行・親の列)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-TENANTRLS-003
  it('親の列の境界は、参照列を辿った先の行の列で比べる(自分の会社の部門の予約だけが見える)', () => {
    expect(oracleVisibility(WORLD, built(), 'a', ROLES).ids).toEqual(['booking-a']);
    expect(oracleVisibility(WORLD, built(), 'b', ROLES).ids).toEqual(['booking-b']);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-TENANTRLS-004
  it('比べる相手は実行者の行であり、セッションの写しではない(写しが古くても行に従う)', () => {
    expect(oracleVisibility(WORLD, built({ stale: true }), 'a', ROLES).ids).toEqual(['booking-a']);
  });

  it('辿った先の行が無ければ見せない(境界の値が不明なら不成立)', () => {
    const world = built({ orphan: true });
    const row = world.rows.get('a:booking');
    expect(row === undefined ? 'missing' : boundaryValue(world, row, { field: 'company_id', actorField: 'company_id', via: ['department_id'] })).toBeUndefined();
    expect(oracleVisibility(WORLD, world, 'a', ROLES).ids).toEqual([]);
  });
});
