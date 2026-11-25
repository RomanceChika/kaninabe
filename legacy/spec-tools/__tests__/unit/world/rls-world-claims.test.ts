/**
 * world の実行者の行に置く、行の条件(`claim`)を満たす値 / 満たさない値(`lib/world/rls-world-claims.ts`。ADR-0018)。
 *
 *   - 満たす人: boolean の欄は真・state / enum の欄は値の集合の先頭。**state の欄に `true` は置かない**
 *   - 満たさない人: 条件の外の値(欄の値域のうち集合に入らないものの先頭。boolean の欄は偽)
 *   - 満たさない人を作れる相手(外の値が置けて、そのロール自身の `claim` の欄と衝突しないもの)
 *   - 条件を宣言しなければ空(従来の world は変わらない)
 */

import { describe, expect, it } from 'vitest';
import { holdingValues, unmetGateRoles, unmetValues } from '../../../lib/world/rls-world-claims.js';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';

/** 有効なメンバーだけが立つ既定ロール。 */
const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active'],
};

/** 運営(boolean の claim)。 */
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };

/** 休会中だけが立つ役(含意なし)。 */
const paused: RoleDef = { ...role('paused'), claim: 'member.state', claimValues: ['suspended'] };

/** 対象の行との関係で立つ役。 */
const manager = role('manager', 'project.manager_id == actor.id', ['member']);

/** 値域を覆い尽くす条件(外の値が無い)。 */
const everyone: RoleDef = {
  ...role('everyone', undefined, undefined, 'system'),
  claim: 'member.state',
  claimValues: ['guest', 'active', 'suspended', 'left'],
};

/** 実行者の集約 member(state の欄はセッションに載る)。 */
function domain(roles: readonly RoleDef[], check?: string): SpecModel {
  return specModel(
    [
      aggregate('member', {
        entity: entitySpec('member', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('display_name', { kind: 'string' }, { required: true, session: true }),
            field('is_staff', { kind: 'boolean' }, { required: true, session: true }),
            field('state', { kind: 'state', machine: 'member' }, { session: true }),
          ],
        }),
        stateMachines: [machine('member', { states: ['guest', 'active', 'suspended', 'left'], initial: 'guest' })],
        ...(check === undefined
          ? {}
          : { invariants: invariantSpec([invariant({ id: 'INV-M-001', entities: ['member'], formal: { kind: 'check', expr: check } })]) }),
      }),
    ],
    roleSpec([role('anonymous', undefined, undefined, 'anonymous'), ...roles]),
  );
}

const conditioned = domain([member, staff, paused, manager]);
const plain = domain([role('member', undefined, undefined, 'authenticated_default'), staff, manager]);

describe('holdingValues(条件を満たす人)', () => {
  it('state の欄には値の集合の先頭を置く(true は置かない)', () => {
    expect(holdingValues(conditioned, 'member')).toEqual({ state: 'active' });
    expect(holdingValues(conditioned, 'manager')).toEqual({ state: 'active' });
  });

  it('boolean の claim の人は、欄が真で、ログインロールの条件も満たす', () => {
    expect(holdingValues(conditioned, 'staff')).toEqual({ is_staff: true, state: 'active' });
  });

  it('条件を宣言しなければ従来のまま(boolean の欄を真にするだけ・束縛の人は空)', () => {
    expect(holdingValues(plain, 'staff')).toEqual({ is_staff: true });
    expect(holdingValues(plain, 'manager')).toEqual({});
  });
});

describe('unmetGateRoles(満たさない人を作れる相手)', () => {
  it('ログインロールの条件と、含意の先の条件を持つロールが相手になる', () => {
    expect(unmetGateRoles(conditioned, 'member')).toEqual(['member']);
    expect(unmetGateRoles(conditioned, 'manager')).toEqual(['member']);
    expect(unmetGateRoles(conditioned, 'staff')).toEqual(['member']);
  });

  it('そのロール自身の claim と同じ欄を外すと根拠が消えるので、作らない', () => {
    expect(unmetGateRoles(conditioned, 'paused')).toEqual([]);
  });

  it('値の集合が値域を覆い尽くす条件には外の値が無いので、作らない', () => {
    const covered = domain([{ ...member, claimValues: ['guest', 'active', 'suspended', 'left'] }, manager]);
    expect(unmetGateRoles(covered, 'manager')).toEqual([]);
    expect(unmetGateRoles(domain([everyone, manager]), 'manager')).toEqual([]);
  });

  it('条件を宣言しなければ空', () => {
    expect(unmetGateRoles(plain, 'manager')).toEqual([]);
    expect(unmetGateRoles(plain, 'staff')).toEqual([]);
  });

  it('根拠の欄が真なら別の欄の値を要求する不変条件とぶつかる負例は、DB に入らないので作らない', () => {
    const guarded = domain([member, staff, manager], 'member.is_staff == false or member.state == active');
    // 運営の行に「有効でない」を置くと CHECK が入れさせない。束縛のロールは根拠の欄が真ではないので作れる
    expect(unmetGateRoles(guarded, 'staff')).toEqual([]);
    expect(unmetGateRoles(guarded, 'manager')).toEqual(['member']);
    expect(unmetGateRoles(guarded, 'member')).toEqual(['member']);
  });

  it('boolean の条件にも外の値(偽)が置ける', () => {
    const booleanLogin: RoleDef = { ...role('member', undefined, undefined, 'authenticated_default'), claim: 'member.is_staff' };
    expect(unmetGateRoles(domain([booleanLogin, manager]), 'manager')).toEqual(['member']);
  });
});

describe('unmetValues(条件を満たさない人)', () => {
  it('ログインロールの条件の外の値(値域の宣言順の先頭)を置く', () => {
    expect(unmetValues(conditioned, 'manager', 'member')).toEqual({ state: 'guest' });
    expect(unmetValues(conditioned, 'staff', 'member')).toEqual({ is_staff: true, state: 'guest' });
  });

  it('ほかの条件は満たす側のまま置く', () => {
    expect(unmetValues(conditioned, 'member', 'member')).toEqual({ state: 'guest' });
  });

  it('boolean の条件は偽にする', () => {
    const booleanLogin: RoleDef = { ...role('member', undefined, undefined, 'authenticated_default'), claim: 'member.is_staff' };
    expect(unmetValues(domain([booleanLogin, manager]), 'manager', 'member')).toEqual({ is_staff: false });
  });

  it('条件を持たない・外の値が置けない相手には何も足さない', () => {
    expect(unmetValues(conditioned, 'manager', 'manager')).toEqual({ state: 'active' });
    expect(unmetValues(conditioned, 'manager', 'nobody')).toEqual({ state: 'active' });
    expect(unmetValues(domain([everyone, manager]), 'manager', 'everyone')).toEqual({});
  });

  it('欄が見つからない・状態機械が無い条件は外の値を置けない', () => {
    const lost: RoleDef = {
      ...role('member', undefined, undefined, 'authenticated_default'),
      claim: 'member.missing',
      claimValues: ['x'],
    };
    expect(unmetGateRoles(domain([lost, manager]), 'manager')).toEqual([]);
  });
});
