/**
 * V23(ログインの既定ロールの状態の条件)の規約網羅テスト。
 *
 * 実行者の集約が状態機械を持つのに、`kind: authenticated_default` のロールが状態の条件(`claim`)を
 * 宣言していなければ、行があれば状態に関わらずそのロールが立つ。それを書き間違いで作らせない。
 * 重さは `ROLE_STATE_CONDITION_SEVERITY` の 1 か所のスイッチで決まる(移行のあいだは警告)。
 */

import { describe, expect, it } from 'vitest';
import {
  createLoginRoleStateConditionVerifier,
  loginRoleStateConditionVerifier,
  ROLE_STATE_CONDITION_SEVERITY,
} from '../../../../lib/verify/verifiers/v23-login-role-state-condition.js';
import { ALL_VERIFIERS } from '../../../../lib/verify/verifiers/index.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { aggregate, entitySpec, field, machine, role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const CTX: VerifyContext = { guards: undefined as never, roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };
const STATES = ['guest', 'active', 'left'];

/** 実行者の集約(`account`)。状態機械を持たせるかを選ぶ。 */
function model(init: { readonly withMachine: boolean; readonly login: RoleDef }) {
  const fields = [
    field('id', { kind: 'uuid' }),
    field('name', { kind: 'string' }, { session: true }),
    ...(init.withMachine ? [field('state', { kind: 'state', machine: 'account' }, { session: true })] : []),
  ];
  return specModel({
    roles: [role('anonymous'), init.login, role('system')],
    aggregates: [
      aggregate({
        name: 'account',
        entity: entitySpec('account', fields),
        stateMachines: init.withMachine ? [machine({ machine: 'account', states: STATES, initial: 'guest' })] : [],
      }),
    ],
  });
}

const plainLogin: RoleDef = role('member', undefined, undefined, 'authenticated_default');
const conditioned: RoleDef = { ...plainLogin, claim: 'account.state', claimValues: ['active'] };

describe('V23 ログインの既定ロールの状態の条件', () => {
  const strict = createLoginRoleStateConditionVerifier('error');

  it('状態機械を持つ実行者の集約で、既定ロールが条件を宣言していなければ落とす(足すものを名指す)', () => {
    const findings = strict.verify(model({ withMachine: true, login: plainLogin }), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'V23', severity: 'error' });
    expect(findings[0]?.message).toContain('ログインの既定ロール member が状態の条件を宣言していません');
    expect(findings[0]?.suggestion).toContain('claim: account.state == ');
    expect(findings[0]?.location).toEqual(plainLogin.location);
    expect(findings[0]?.counterexample).toEqual({ role: 'member', actor_entity: 'account', state_field: 'state' });
  });

  it('既定ロールが状態の欄に claim を宣言していれば通す(== / in のどちらでも)', () => {
    expect(strict.verify(model({ withMachine: true, login: conditioned }), CTX)).toEqual([]);
    const among: RoleDef = { ...conditioned, claimValues: ['active', 'guest'] };
    expect(strict.verify(model({ withMachine: true, login: among }), CTX)).toEqual([]);
  });

  it('別の欄への claim は条件に数えない(状態の欄を指していない)', () => {
    const other: RoleDef = { ...plainLogin, claim: 'account.name' };
    expect(strict.verify(model({ withMachine: true, login: other }), CTX)).toHaveLength(1);
  });

  it('状態機械を持たない実行者の集約は対象外(条件を足す先の状態が無い)', () => {
    expect(strict.verify(model({ withMachine: false, login: plainLogin }), CTX)).toEqual([]);
  });

  it('実行者の集約が無い(session: true の欄が無い)仕様は対象外', () => {
    const none = specModel({ roles: [role('anonymous'), plainLogin, role('system')], aggregates: [] });
    expect(strict.verify(none, CTX)).toEqual([]);
  });

  it('kind: authenticated_default 以外のロールは見ない', () => {
    const noLogin = model({ withMachine: true, login: role('staff') });
    expect(strict.verify(noLogin, CTX)).toEqual([]);
  });
});

describe('V23 の重さは 1 つのスイッチで決まる', () => {
  const subject = model({ withMachine: true, login: plainLogin });

  it('同じ入力が、渡した重さのまま error にも warning にもなる', () => {
    expect(createLoginRoleStateConditionVerifier('error').verify(subject, CTX).map((f) => f.severity)).toEqual(['error']);
    expect(createLoginRoleStateConditionVerifier('warning').verify(subject, CTX).map((f) => f.severity)).toEqual(['warning']);
  });

  it('登録される検証器の重さは ROLE_STATE_CONDITION_SEVERITY そのもの(他に重さを決める場所が無い)', () => {
    expect(ALL_VERIFIERS).toContain(loginRoleStateConditionVerifier);
    expect(loginRoleStateConditionVerifier.verify(subject, CTX).map((f) => f.severity)).toEqual([
      ROLE_STATE_CONDITION_SEVERITY,
    ]);
  });
});
