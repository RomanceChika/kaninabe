/**
 * ロール階層(implies)を辿るユーティリティのテスト。
 * 対象の要求: domain-spec-writing.md「implies は必ず併せ持つロールの宣言」。
 */

import { describe, expect, it } from 'vitest';
import {
  findImplyCycle,
  globalRoleId,
  impliedRoles,
  policyGranteeOf,
  policyGranteeRoles,
  rowConditionRoles,
  systemRoleId,
} from '../../../lib/model/role-hierarchy.js';
import type { RoleDef, RoleKind } from '../../../lib/model/types.js';
import { loc } from '../../helpers/model-builder.js';

/** implies だけを持つロールを作る。 */
function r(id: string, implies?: readonly string[]): RoleDef {
  const base = { id, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
  return implies === undefined ? base : { ...base, implies };
}

/** kind だけを持つグローバルロールを作る。 */
function g(id: string, kind: RoleKind): RoleDef {
  return { id, kind, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
}

describe('impliedRoles', () => {
  it('宣言が無ければ空集合', () => {
    expect([...impliedRoles([r('member')], 'member')]).toEqual([]);
  });

  it('直接の含意を返す', () => {
    expect([...impliedRoles([r('member'), r('organizer', ['member'])], 'organizer')]).toEqual([
      'member',
    ]);
  });

  it('推移的に辿る', () => {
    const roles = [r('member'), r('staff', ['member']), r('admin', ['staff'])];

    expect([...impliedRoles(roles, 'admin')].sort()).toEqual(['member', 'staff']);
  });

  it('循環していても停止する', () => {
    const roles = [r('a', ['b']), r('b', ['a'])];

    expect([...impliedRoles(roles, 'a')]).toEqual(['b']);
  });
});

describe('findImplyCycle', () => {
  it('循環が無ければ null', () => {
    expect(findImplyCycle([r('member'), r('organizer', ['member'])])).toBeNull();
  });

  it('循環を経路として返す', () => {
    expect(findImplyCycle([r('a', ['b']), r('b', ['a'])])).toEqual(['a', 'b', 'a']);
  });

  it('3 つ以上の循環も見つける', () => {
    expect(findImplyCycle([r('a', ['b']), r('b', ['c']), r('c', ['a'])])).toEqual([
      'a',
      'b',
      'c',
      'a',
    ]);
  });
});

describe('globalRoleId', () => {
  it('kind に一致するロールの id を返す', () => {
    const roles = [g('anonymous', 'anonymous'), g('member', 'authenticated_default'), g('system', 'system')];

    expect(globalRoleId(roles, 'anonymous')).toBe('anonymous');
    expect(globalRoleId(roles, 'authenticated_default')).toBe('member');
    expect(globalRoleId(roles, 'system')).toBe('system');
  });

  it('kind を持つロールが無ければ undefined(ロール名を決め打ちしない)', () => {
    expect(globalRoleId([r('member')], 'system')).toBeUndefined();
  });

  it('roles.md がどんな綴りを選んでも、kind だけを見て引ける', () => {
    // このアプリの都合で "member" ではなく別の語を選んでも解決できることを確かめる
    // (dsl-extension-triage.md §軸と語: 軸は仕組み・語はアプリ)。
    const roles = [g('guest_or_signed_in', 'anonymous'), g('registered_user', 'authenticated_default')];

    expect(globalRoleId(roles, 'anonymous')).toBe('guest_or_signed_in');
    expect(globalRoleId(roles, 'authenticated_default')).toBe('registered_user');
  });
});

describe('systemRoleId', () => {
  it('kind: system のロール id を返す', () => {
    expect(systemRoleId([g('system', 'system'), r('member')])).toBe('system');
  });

  it('kind: system が無ければ undefined', () => {
    expect(systemRoleId([r('member')])).toBeUndefined();
  });
});

describe('policyGranteeOf(ポリシーの宛先になる役割)', () => {
  const roles = [g('guest', 'anonymous'), g('member', 'authenticated_default'), g('system', 'system'), r('organizer', ['member'])];

  it('未ログインのロールだけが anonymous 宛、ほかはすべて authenticated_default 宛', () => {
    expect(policyGranteeOf(roles, 'guest')).toBe('anonymous');
    expect(policyGranteeOf(roles, 'member')).toBe('authenticated_default');
    expect(policyGranteeOf(roles, 'organizer')).toBe('authenticated_default');
  });

  it('未ログインのロールが宣言されていない仕様では、どのロールも authenticated_default 宛', () => {
    expect(policyGranteeOf([g('member', 'authenticated_default')], 'member')).toBe('authenticated_default');
  });
});

describe('policyGranteeRoles(ポリシーを実際に与える役割の一覧)', () => {
  it('未ログイン宛のポリシーはログイン中の人にも効く(ログインしたことで見られなくなってはならない)', () => {
    expect(policyGranteeRoles('anonymous')).toEqual(['anonymous', 'authenticated_default']);
  });

  it('ログインのロール宛のポリシーはログイン中の人だけ', () => {
    expect(policyGranteeRoles('authenticated_default')).toEqual(['authenticated_default']);
  });
});

describe('rowConditionRoles(含意の先の行の条件)', () => {
  /** claim を持つロール。 */
  function c(id: string, claim: string, implies?: readonly string[]): RoleDef {
    return { ...r(id, implies), claim };
  }

  it('含意の先に claim を持つロールが無ければ空(宣言しなければ何も足さない)', () => {
    const roles = [g('member', 'authenticated_default'), r('organizer', ['member'])];
    expect(rowConditionRoles(roles, 'organizer')).toEqual([]);
  });

  it('含意の先で claim を持つロールだけを返す', () => {
    const member: RoleDef = { ...g('member', 'authenticated_default'), claim: 'member.state', claimValues: ['active'] };
    const roles = [member, r('organizer', ['member'])];
    expect(rowConditionRoles(roles, 'organizer').map((role) => role.id)).toEqual(['member']);
  });

  it('推移的な含意も辿る(2 段先でも条件を落とさない)', () => {
    const roles = [c('base', 'member.state'), r('mid', ['base']), r('top', ['mid'])];
    expect(rowConditionRoles(roles, 'top').map((role) => role.id)).toEqual(['base']);
  });

  it('起点自身の claim は含めない(自分の根拠は別に写す)', () => {
    const roles = [c('self', 'member.is_staff')];
    expect(rowConditionRoles(roles, 'self')).toEqual([]);
  });

  it('未知のロール ID は空', () => {
    expect(rowConditionRoles([], 'ghost')).toEqual([]);
  });
});
