/**
 * 実行計画の判断が **`claim` の値の集合と含意の先の行の条件**をどう読むかのテスト(ADR-0018)。
 *
 * 計画はこのテストの中に書く(製品の生成物に依存しない)。手順に立つロールは `rolesOfWith` が
 * セッションの写し(`resolution.session`)と表(`RoleTables`)から決める。
 */

import { describe, expect, it } from 'vitest';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { RoleTables } from '../../_template/actor-roles';
import type { DecideContext } from '../../_template/run-plan-decide-core';
import { planActorRolesWith, rolesOfWith } from '../../_template/run-plan-decide-core';

const ACTOR = 'a1';

/** 既定のログインロールが `state in [active]` を宣言し、`staff`(boolean)と `paused`(値の集合)がある表。 */
const TABLES: RoleTables = {
  anonymous: 'anonymous',
  authenticated: 'member',
  system: 'system',
  implications: { staff: ['member'] },
  authenticatedWhen: { field: 'state', values: ['active'] },
  gates: { staff: [{ field: 'state', values: ['active'] }] },
};

const STEP: RunStepPlan = {
  op: 'widget.update',
  alias: 'widget.update',
  label: '更新',
  kind: 'update',
  aggregate: 'widget',
  repeat: false,
  self: false,
  event: null,
  createRules: null,
  deleteRules: null,
  writeRules: null,
  machine: null,
  stateFrom: null,
  guardFacts: [],
  roleFacts: [],
  claimFacts: [
    { role: 'staff', field: 'is_staff' },
    { role: 'paused', field: 'state', values: ['suspended', 'lapsed'] },
  ],
  unresolvableRoles: [],
  inputKeys: [],
};

const PLAN: RunPlan = {
  usecase: 'widget',
  save: 'update',
  rpc: 'update_widget',
  call: { kind: 'composite' },
  reads: [],
  expectedKeys: [],
  steps: [STEP],
  invariantHooks: [],
  result: { entity: 'widget', idFrom: { kind: 'idempotency' }, state: null },
};

/** セッションの写しが `session` の実行者の判断の材料。 */
function context(session: DecideContext['resolution']['session']): DecideContext {
  return {
    resolution: { facts: {}, actorId: ACTOR, session, input: {}, now: '2026-04-01T00:00:00.000Z' },
    system: false,
  };
}

describe('rolesOfWith — claim の値の集合とログインロールの条件', () => {
  it('条件を満たす実行者: ログインロールと、boolean の claim のロール(含意の先の条件も満たす)が立つ', () => {
    expect(rolesOfWith(TABLES, PLAN, STEP, context({ state: 'active', is_staff: true }))).toEqual([
      'member',
      'staff',
    ]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-003
  it('値の集合の claim: 集合に入る状態のときだけ立つ(ログインロールは立たず未ログインと同じ)', () => {
    expect(rolesOfWith(TABLES, PLAN, STEP, context({ state: 'suspended', is_staff: false }))).toEqual([
      'anonymous',
      'paused',
    ]);
    expect(rolesOfWith(TABLES, PLAN, STEP, context({ state: 'left', is_staff: false }))).toEqual(['anonymous']);
  });

  it('含意の先の条件を満たさない実行者は、boolean の claim が真でも staff が立たない', () => {
    expect(rolesOfWith(TABLES, PLAN, STEP, context({ state: 'suspended', is_staff: true }))).toEqual([
      'anonymous',
      'paused',
    ]);
  });

  it('写しが無い実行者(行が無い)は何も立たない', () => {
    expect(rolesOfWith(TABLES, PLAN, STEP, context(null))).toEqual(['anonymous']);
  });
});

describe('planActorRolesWith — RPC に渡す集合', () => {
  it('条件を満たさない実行者の集合は、満たさないロールを含まない', () => {
    expect(planActorRolesWith(TABLES, PLAN, context({ state: 'left', is_staff: true }))).toEqual(['anonymous']);
    expect(planActorRolesWith(TABLES, PLAN, context({ state: 'active', is_staff: true }))).toEqual([
      'member',
      'staff',
    ]);
  });
});
