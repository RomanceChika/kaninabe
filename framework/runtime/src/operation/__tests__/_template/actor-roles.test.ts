/**
 * ロール解決の表(`RoleTables`)の読み方のテスト。ADR-0018(`claim` の値の集合と含意の先の行の条件)。
 *
 * 確かめるのは 4 点である。
 *
 *   1. 条件を宣言しない表では従来と同じ(行があれば既定のログインロール・束縛が成立すれば足される)
 *   2. 既定のログインロールが行の条件を宣言していれば、セッションの写しがそれを満たすときだけ立つ
 *      (満たさない実行者は未ログインと同じロールになる)
 *   3. 行の条件を持つロールを含意するロールは、その条件も満たすときだけ立つ(束縛が成立していても)
 *   4. システム起点・未ログインは条件の影響を受けない
 *
 * 表はこのテストの中に書く(ロール ID は仮の語。軸だけを使う)。
 */

import { describe, expect, it } from 'vitest';
import type { RoleTables } from '../../_template/actor-roles';
import { globalRoleWith, resolveActorRolesWith } from '../../_template/actor-roles';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** 条件を宣言しない表(従来の形)。 */
const PLAIN: RoleTables = {
  anonymous: 'anonymous',
  authenticated: 'member',
  system: 'system',
  implications: { owner: ['member'], staff: ['member'] },
};

/** ログインロールが `state in [active]` を宣言し、`owner` / `staff` がそれを含意する表。 */
const GATED: RoleTables = {
  ...PLAIN,
  authenticatedWhen: { field: 'state', values: ['active'] },
  gates: {
    owner: [{ field: 'state', values: ['active'] }],
    staff: [{ field: 'state', values: ['active'] }],
  },
};

describe('globalRoleWith', () => {
  it('条件を宣言しない表: 行があれば既定のログインロール・無ければ未ログインのロール', () => {
    expect(globalRoleWith(PLAIN, ACTOR, {})).toBe('member');
    expect(globalRoleWith(PLAIN, ACTOR, null)).toBe('anonymous');
    expect(globalRoleWith(PLAIN, null, {})).toBe('anonymous');
  });

  it('条件を宣言した表: 写しが値の集合に入っていれば既定のログインロール', () => {
    expect(globalRoleWith(GATED, ACTOR, { state: 'active' })).toBe('member');
  });

  it('条件を宣言した表: 値の集合に入らない・欄が無い・型が合わない実行者は未ログインと同じロール', () => {
    expect(globalRoleWith(GATED, ACTOR, { state: 'guest' })).toBe('anonymous');
    expect(globalRoleWith(GATED, ACTOR, {})).toBe('anonymous');
    expect(globalRoleWith(GATED, ACTOR, { state: true })).toBe('anonymous');
  });

  it('条件を宣言した表でも、行が無い・未ログインは未ログインのロール', () => {
    expect(globalRoleWith(GATED, ACTOR, null)).toBe('anonymous');
    expect(globalRoleWith(GATED, null, { state: 'active' })).toBe('anonymous');
  });

  it('boolean の条件は欄が真のときだけ立つ', () => {
    const boolean: RoleTables = { ...PLAIN, authenticatedWhen: { field: 'is_ok' } };
    expect(globalRoleWith(boolean, ACTOR, { is_ok: true })).toBe('member');
    expect(globalRoleWith(boolean, ACTOR, { is_ok: false })).toBe('anonymous');
  });
});

describe('resolveActorRolesWith', () => {
  it('条件を宣言しない表: 束縛が成立したロールを足し、含意で閉じる(従来どおり)', () => {
    expect(resolveActorRolesWith(PLAIN, ACTOR, {}, { owner: ACTOR }, false)).toEqual(['member', 'owner']);
    expect(resolveActorRolesWith(PLAIN, ACTOR, {}, { owner: OTHER }, false)).toEqual(['member']);
  });

  it('条件を満たす実行者は、束縛のロールもその含意も付く', () => {
    expect(resolveActorRolesWith(GATED, ACTOR, { state: 'active' }, { owner: ACTOR }, false)).toEqual([
      'member',
      'owner',
    ]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-001
  it('条件を満たさない実行者は、束縛が成立していても含意の先の条件を満たさないロールが付かない', () => {
    expect(resolveActorRolesWith(GATED, ACTOR, { state: 'left' }, { owner: ACTOR, staff: ACTOR }, false)).toEqual([
      'anonymous',
    ]);
  });

  it('条件を持たないロール(含意の先に条件が無い)は、条件を満たさない実行者にも付く', () => {
    const ungated: RoleTables = { ...GATED, implications: { ...GATED.implications, self: [] } };
    expect(resolveActorRolesWith(ungated, ACTOR, { state: 'left' }, { self: ACTOR }, false)).toEqual([
      'anonymous',
      'self',
    ]);
  });

  it('行が無い実行者(写しが null)の束縛のロールは、条件があるものは落ちる', () => {
    expect(resolveActorRolesWith(GATED, ACTOR, null, { owner: ACTOR }, false)).toEqual(['anonymous']);
  });

  it('行の条件を持つロールの条件は、含意の先の値の集合どおりに効く(休会の実例: 複数の値)', () => {
    const paused: RoleTables = {
      ...PLAIN,
      gates: { owner: [{ field: 'state', values: ['suspended', 'lapsed'] }] },
    };
    expect(resolveActorRolesWith(paused, ACTOR, { state: 'lapsed' }, { owner: ACTOR }, false)).toEqual([
      'member',
      'owner',
    ]);
    expect(resolveActorRolesWith(paused, ACTOR, { state: 'active' }, { owner: ACTOR }, false)).toEqual(['member']);
  });

  it('複数の条件は全部満たすときだけ(boolean と値の集合の併用)', () => {
    const both: RoleTables = {
      ...PLAIN,
      gates: {
        staff: [{ field: 'state', values: ['active'] }, { field: 'is_staff' }],
      },
    };
    const holds = { state: 'active', is_staff: true };
    expect(resolveActorRolesWith(both, ACTOR, holds, { staff: ACTOR }, false)).toEqual(['member', 'staff']);
    expect(resolveActorRolesWith(both, ACTOR, { ...holds, is_staff: false }, { staff: ACTOR }, false)).toEqual([
      'member',
    ]);
  });

  it('未ログインとシステム起点は条件の影響を受けない', () => {
    expect(resolveActorRolesWith(GATED, null, null, { owner: ACTOR }, false)).toEqual(['anonymous']);
    expect(resolveActorRolesWith(GATED, null, null, {}, true)).toEqual(['system']);
  });
});
