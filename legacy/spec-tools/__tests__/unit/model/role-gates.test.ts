/**
 * 行の条件(`claim`)の導出のテスト(ADR-0018)。
 *
 *   - `rowConditionOf` / `addCondition`: ロールの `claim` を実行時の計画・表に出る形にする
 *   - `loginCondition` / `impliedConditions` / `roleGateTable` / `groundedConditions`: 既定のログインロールの条件と
 *     含意の先の条件(E2)。条件を宣言しなければ何も出ない(宣言しなければ生成物は変わらない)
 *   - `holdingRowValues`: 条件を全部満たす値(自分の `claim` → 含意の先 → ログインの順に重ねる)
 */

import { describe, expect, it } from 'vitest';
import { addCondition, rowConditionOf } from '../../../lib/model/role-claim.js';
import type { RowCondition } from '../../../lib/model/role-claim.js';
import {
  groundedConditions,
  impliedConditions,
  loginCondition,
  roleGateTable,
} from '../../../lib/model/role-hierarchy.js';
import { conditionsFor, holdingRowValues } from '../../../lib/model/role-row-values.js';
import type { RoleDef } from '../../../lib/model/types.js';
import { role } from '../../helpers/model-builder.js';

/** 有効なメンバーだけが立つ既定ロール(kind と claim の併記)。 */
const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active', 'trial'],
};

/** 条件を宣言しない既定ロール(従来の形)。 */
const plainMember: RoleDef = role('member', undefined, undefined, 'authenticated_default');

/** 運営(boolean の claim)。含意の先に member を持つ。 */
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };

/** 休会中だけが立つ役(kind なし・implies なしの値の集合)。 */
const paused: RoleDef = { ...role('paused'), claim: 'member.state', claimValues: ['suspended', 'lapsed'] };

/** 対象の行との関係で立つ役。 */
const manager = role('manager', 'project.manager_id == actor.id', ['member']);

/** 2 段先で member に届く役。 */
const mid: RoleDef = role('mid', undefined, ['member']);
const top: RoleDef = { ...role('top', undefined, ['mid']), claim: 'member.is_top' };

const base: readonly RoleDef[] = [
  role('anonymous', undefined, undefined, 'anonymous'),
  role('system', undefined, undefined, 'system'),
];
const withCondition: readonly RoleDef[] = [...base, member, staff, paused, manager, mid, top];
const withoutCondition: readonly RoleDef[] = [...base, plainMember, staff, paused, manager, mid, top];

describe('rowConditionOf / addCondition', () => {
  it('boolean の claim は欄だけ・値の集合の claim は欄と値(宣言順)', () => {
    expect(rowConditionOf(staff)).toEqual({ field: 'is_staff' });
    expect(rowConditionOf(staff)).not.toHaveProperty('values');
    expect(rowConditionOf(member)).toEqual({ field: 'state', values: ['active', 'trial'] });
  });

  it('claim を持たないロールは条件を持たない', () => {
    expect(rowConditionOf(plainMember)).toBeNull();
    expect(rowConditionOf(manager)).toBeNull();
  });

  it('同じ欄・同じ値の集合は 1 つにする(値の集合が違えば別の条件)', () => {
    const into: RowCondition[] = [];
    addCondition(into, { field: 'state', values: ['active'] });
    addCondition(into, { field: 'state', values: ['active'] });
    addCondition(into, { field: 'state', values: ['active', 'trial'] });
    addCondition(into, { field: 'is_staff' });
    addCondition(into, { field: 'is_staff' });
    expect(into).toEqual([
      { field: 'state', values: ['active'] },
      { field: 'state', values: ['active', 'trial'] },
      { field: 'is_staff' },
    ]);
  });
});

describe('loginCondition / impliedConditions / roleGateTable / groundedConditions', () => {
  it('既定のログインロールの条件(併記があるときだけ)', () => {
    expect(loginCondition(withCondition)).toEqual({ field: 'state', values: ['active', 'trial'] });
    expect(loginCondition(withoutCondition)).toBeNull();
    expect(loginCondition(base)).toBeNull();
  });

  it('含意の先の条件: claim を持つロールを含意する側に、その条件が出る(多段でも落ちない)', () => {
    expect(impliedConditions(withCondition, 'staff')).toEqual([{ field: 'state', values: ['active', 'trial'] }]);
    expect(impliedConditions(withCondition, 'manager')).toEqual([{ field: 'state', values: ['active', 'trial'] }]);
    expect(impliedConditions(withCondition, 'top')).toEqual([{ field: 'state', values: ['active', 'trial'] }]);
  });

  it('含意の先に条件が無ければ空(宣言しなければ何も足さない)', () => {
    expect(impliedConditions(withoutCondition, 'staff')).toEqual([]);
    expect(impliedConditions(withCondition, 'paused')).toEqual([]);
    expect(impliedConditions(withCondition, 'member')).toEqual([]);
  });

  it('ロール解決の表: 条件を持つロールだけがキーになる', () => {
    expect(roleGateTable(withCondition)).toEqual({
      staff: [{ field: 'state', values: ['active', 'trial'] }],
      manager: [{ field: 'state', values: ['active', 'trial'] }],
      mid: [{ field: 'state', values: ['active', 'trial'] }],
      top: [{ field: 'state', values: ['active', 'trial'] }],
    });
    expect(roleGateTable(withoutCondition)).toEqual({});
  });

  it('DB の述語の写し: 既定のログインロールは自分の条件・それ以外は含意の先の条件', () => {
    expect(groundedConditions(withCondition, 'member')).toEqual([{ field: 'state', values: ['active', 'trial'] }]);
    expect(groundedConditions(withCondition, 'staff')).toEqual([{ field: 'state', values: ['active', 'trial'] }]);
    expect(groundedConditions(withCondition, 'paused')).toEqual([]);
    expect(groundedConditions(withoutCondition, 'member')).toEqual([]);
  });

  it('含意の先に同じ条件が複数あっても 1 つにする', () => {
    const second: RoleDef = { ...role('second', undefined, undefined, 'system'), claim: 'member.state', claimValues: ['active', 'trial'] };
    const both = role('both', undefined, ['member', 'second']);
    expect(groundedConditions([...base.slice(0, 1), member, second, both], 'both')).toEqual([
      { field: 'state', values: ['active', 'trial'] },
    ]);
  });
});

describe('holdingRowValues', () => {
  it('条件の優先順: 自分の claim → 含意の先 → ログイン', () => {
    expect(conditionsFor(withCondition, 'staff')).toEqual([
      { field: 'is_staff' },
      { field: 'state', values: ['active', 'trial'] },
      { field: 'state', values: ['active', 'trial'] },
    ]);
  });

  it('boolean の欄は真・state / enum の欄は値の集合の先頭を選ぶ(true は置かない)', () => {
    expect(holdingRowValues(withCondition, 'staff')).toEqual({ is_staff: true, state: 'active' });
    expect(holdingRowValues(withCondition, 'member')).toEqual({ state: 'active' });
  });

  it('束縛のロールも、ログインロールの条件を満たす値になる(含意の先)', () => {
    expect(holdingRowValues(withCondition, 'manager')).toEqual({ state: 'active' });
  });

  it('条件を宣言しなければ空(従来のロールは値を足さない)', () => {
    expect(holdingRowValues(withoutCondition, 'manager')).toEqual({});
    expect(holdingRowValues(withoutCondition, 'member')).toEqual({});
    expect(holdingRowValues(withoutCondition, 'staff')).toEqual({ is_staff: true });
  });

  it('同じ欄に集合が重なれば共通部分の先頭・共通部分が空なら先に来た(自分の)条件', () => {
    const narrow: RoleDef = { ...role('narrow', undefined, ['member']), claim: 'member.state', claimValues: ['trial', 'vip'] };
    expect(holdingRowValues([...base, member, narrow], 'narrow')).toEqual({ state: 'trial' });
    expect(holdingRowValues([...base, member, paused], 'paused')).toEqual({ state: 'suspended' });
  });

  it('未知のロールは空', () => {
    expect(holdingRowValues(withCondition, 'nobody')).toEqual({ state: 'active' });
  });
});
