/**
 * 条件を満たさない実行者の導出(`lib/model/role-unmet-values.ts`。ADR-0018)。
 *
 *   - `enforcedUnmetRoleIds`: 拒否になる相手だけ(既定のログインロール自身と、含意の先に条件を持つロールを含意するロール)。
 *     含意しない束縛のロールは、条件の外の状態でも許されたままなので相手にならない
 *   - 生成ユニットテストの「条件を満たさない実行者は拒否される」場面は、条件が課されていない役では作らない
 */

import { describe, expect, it } from 'vitest';
import { enforcedUnmetRoleIds, unmetGateRoleIds } from '../../../lib/model/role-unmet-values.js';
import { unmetConditionScenario } from '../../../lib/usecase/plan-scenario-unmet.js';
import type { ScenarioContext } from '../../../lib/usecase/plan-scenario-rows.js';
import type { ScenarioInput } from '../../../lib/usecase/plan-scenario.js';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';

const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active'],
};
/** 含意しない束縛のロール(本人)。条件の外の状態でも立つ。 */
const self = role('self', 'member.id == actor.id');
/** member を含意する束縛のロール。 */
const manager = role('manager', 'project.manager_id == actor.id', ['member']);
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };

function domain(): SpecModel {
  return specModel(
    [
      aggregate('member', {
        entity: entitySpec('member', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('is_staff', { kind: 'boolean' }, { session: true }),
            field('state', { kind: 'state', machine: 'member' }, { session: true }),
          ],
        }),
        stateMachines: [machine('member', { states: ['guest', 'active', 'left'], initial: 'guest' })],
      }),
    ],
    roleSpec([role('anonymous', undefined, undefined, 'anonymous'), member, self, manager, staff]),
  );
}

describe('enforcedUnmetRoleIds', () => {
  it('既定のログインロール自身と、それを含意するロールは拒否になる相手を持つ', () => {
    expect(enforcedUnmetRoleIds(domain(), 'member')).toEqual(['member']);
    expect(enforcedUnmetRoleIds(domain(), 'manager')).toEqual(['member']);
    expect(enforcedUnmetRoleIds(domain(), 'staff')).toEqual(['member']);
  });

  it('含意しない束縛のロールには課されていないので、相手が無い(世界では満たさない人を立てるが、拒否を期待しない)', () => {
    expect(unmetGateRoleIds(domain(), 'self')).toEqual(['member']);
    expect(enforcedUnmetRoleIds(domain(), 'self')).toEqual([]);
  });

  it('条件を宣言していなければ空', () => {
    const plain = specModel(
      [aggregate('member', { entity: entitySpec('member', { fields: [field('id', { kind: 'uuid' })] }) })],
      roleSpec([role('anonymous', undefined, undefined, 'anonymous'), role('member', undefined, undefined, 'authenticated_default'), manager]),
    );
    expect(enforcedUnmetRoleIds(plain, 'manager')).toEqual([]);
    expect(enforcedUnmetRoleIds(plain, 'member')).toEqual([]);
  });
});

describe('unmetConditionScenario — 条件が課されていない役では場面を作らない', () => {
  const input = { domain: domain() } as unknown as ScenarioInput;
  const ctx = { allowedRoles: ['self'], label: '更新' } as unknown as ScenarioContext;
  const solved = { env: {}, changeField: null, claims: {} };

  it('含意しない束縛のロール(本人)は、条件の外の状態でも許されるので、拒否の場面を作らない', () => {
    expect(unmetConditionScenario(input, ctx, 'self', solved)).toBeNull();
  });

  it('未ログインのロールが実行できる操作・未ログインのロールそのものでも作らない', () => {
    expect(unmetConditionScenario(input, { ...ctx, allowedRoles: ['anonymous'] } as unknown as ScenarioContext, 'manager', solved)).toBeNull();
    expect(unmetConditionScenario(input, ctx, 'anonymous', solved)).toBeNull();
  });
});
