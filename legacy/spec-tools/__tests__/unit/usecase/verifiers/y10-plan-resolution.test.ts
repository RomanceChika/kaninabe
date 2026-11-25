/**
 * Y10(実行計画)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md §Y10 の考え方 —— 保存点の `permit` が要る値
 * (ガード式の変数・文脈ロールの binding・保存点の外から読む行の絞り込み)の供給元が
 * 1 つ残らず規約で決まること。決まらなければ反例つきで止める。
 *
 * 束⑯g で足した warning も同じ検証器が出す —— 保存点が触る集約の不変条件のうち、
 * **application 執行なのに実行されない**もの(hooks の母集合を狭めた判断を見えるようにする。
 * ADR-0012 の当座)。
 */

import { describe, expect, it } from 'vitest';
import { planResolutionVerifier } from '../../../../lib/usecase/verifiers/y10-plan-resolution.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { usecaseAcceptInvariant } from '../../../helpers/usecase-builder.js';
import type { InvariantDef } from '../../../../lib/model/types.js';
import type { UsecaseContext } from '../../../../lib/usecase/verifier.js';
import type { UsecaseInput } from '../../../../lib/usecase/derive.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { UsecaseSpec } from '../../../../lib/model/usecase/types.js';
import { testGates, testScreens } from '../_fixtures.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 複合 RPC の世界を持つ UsecaseInput / UsecaseContext。 */
function inputFor(usecase: UsecaseSpec, domain: SpecModel = rpcDomain()): { input: UsecaseInput; ctx: UsecaseContext } {
  return {
    input: {
      domain,
      usecases: { available: true, usecases: [usecase] },
      actions: rpcActions(),
      screens: testScreens(),
      gates: testGates(),
      catalogs: {},
    },
    ctx: { guards: stubGuards(), dataTables: loadedInput(rpcDataTables()), actions: UNSELECTED, reachabilityGaps: [] },
  };
}

/** container.create → item.create → item.submit の 1 保存点。 */
function registerUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave(
        'register',
        [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')],
        { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
      ),
    ],
  });
}

/** kind も binding も持たないロール(staff)だけが container の作成を認める世界(根拠は行の属性)。 */
function staffOnlyDomain(): SpecModel {
  const domain = rpcDomain();
  return specModel(
    [...domain.aggregates.values()].map((specs) =>
      specs.name === 'container'
        ? aggregate('container', {
            ...(specs.entity === undefined ? {} : { entity: specs.entity }),
            access: accessSpec('container', { creates: [create('staff')] }),
          })
        : aggregate(specs.name, {
            ...(specs.entity === undefined ? {} : { entity: specs.entity }),
            ...(specs.access === undefined ? {} : { access: specs.access }),
            stateMachines: specs.stateMachines,
          }),
    ),
    // staff は kind も binding も持たない(根拠は行の属性)。
    roleSpec([role('member'), role('anonymous'), role('system'), role('staff')]),
  );
}

describe('Y10 実行計画', () => {
  it('`permit` が要る値が全部決まる保存点は通る', () => {
    const { input, ctx } = inputFor(registerUsecase());

    expect(planResolutionVerifier.verify(input, ctx)).toEqual([]);
  });

  it('data_table が使えない(未選択・阻害)環境では何も見ない(接地そのものができない。見ていないことは実行ログが言う)', () => {
    const { input } = inputFor(registerUsecase());

    expect(planResolutionVerifier.verify(input, { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
    expect(planResolutionVerifier.verify(input, { guards: stubGuards(), dataTables: blockedInput(), actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
  });

  it('保存点の外の集約を条件にしていて、その id を指す入力欄が無ければ違反になる', () => {
    // container の作成に「保存点の外の集約 gate の状態」を条件として足す。
    // gate は保存点で作らず、id を指す入力欄(gate_id)もどこにも無い。
    const domain = rpcDomain();
    const withGate = specModel(
      [
        ...[...domain.aggregates.values()].map((specs) =>
          specs.name === 'container'
            ? aggregate('container', {
                ...(specs.entity === undefined ? {} : { entity: specs.entity }),
                access: accessSpec('container', { creates: [create('member', 'gate.state == open')] }),
              })
            : aggregate(specs.name, {
                ...(specs.entity === undefined ? {} : { entity: specs.entity }),
                ...(specs.access === undefined ? {} : { access: specs.access }),
                stateMachines: specs.stateMachines,
              }),
        ),
        aggregate('gate', {
          entity: entitySpec('gate', {
            fields: [field('id', { kind: 'uuid' }), field('state', { kind: 'string' }, { required: true })],
          }),
        }),
      ],
      roleSpec([role('member'), role('anonymous'), role('system')]),
    );
    const { input, ctx } = inputFor(registerUsecase(), withGate);

    const findings = planResolutionVerifier.verify(input, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y10');
    expect(findings[0]?.counterexample).toMatchObject({ entity: 'gate', field: 'state' });
  });
  // 保存点の実行器が立てられるのは、セッションから立つグローバルロール(role_spec の `kind`)と、
  // 計画が供給元を持つ文脈ロール(`binding`)だけである。どちらも持たないロール(行の属性が
  // 根拠のもの)しか認めていない手順は、誰も通れない = 保存点に置けない。
  it('kind も binding も持たないロールだけが認める手順は違反になる', () => {
    const withStaffOnly = staffOnlyDomain();
    const { input, ctx } = inputFor(registerUsecase(), withStaffOnly);

    const findings = planResolutionVerifier.verify(input, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y10');
    expect(findings[0]?.counterexample).toMatchObject({ step: 'container.create', roles: 'staff' });
  });
});

describe('Y10 action_spec が阻害のとき', () => {
  it('実行計画が入力欄を引くので判定を出さない(未選択は「action_spec は無い」事実で従来どおり判定する)', () => {
    const { input, ctx } = inputFor(registerUsecase(), staffOnlyDomain());

    expect(planResolutionVerifier.verify(input, { ...ctx, actions: UNSELECTED })).toHaveLength(1);
    expect(planResolutionVerifier.verify(input, { ...ctx, actions: blockedInput('invalid') })).toEqual([]);
  });
});

describe('Y10 実行されない不変条件(warning)', () => {
  /** `item` 集約に不変条件を持たせた世界。 */
  function withInvariants(invariants: readonly InvariantDef[]): SpecModel {
    const domain = rpcDomain();
    const aggregates = new Map(domain.aggregates);
    const item = aggregates.get('item');
    if (item !== undefined) aggregates.set('item', { ...item, invariants: invariantSpec(invariants) });
    return { ...domain, aggregates };
  }

  it('保存点が触る集約の application 執行の不変条件が実行されないなら warning を出す', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-ITEM-001',
        entities: ['item'],
        enforcedBy: [{ kind: 'application', ref: 'assertItem', location: { file: 'f', pointer: 'p' } }],
      }),
    ]);
    const { input, ctx } = inputFor(registerUsecase(), domain);

    const findings = planResolutionVerifier.verify(input, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.counterexample).toMatchObject({ invariant: 'INV-ITEM-001', entities: 'item' });
  });

  it('その保存点の手順を guard として名指しした不変条件は hooks が要求されるので warning を出さない', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-ITEM-001',
        entities: ['item'],
        enforcedBy: [
          { kind: 'application', ref: 'assertItem', location: { file: 'f', pointer: 'p' } },
          { kind: 'guard', ref: 'item.submit', location: { file: 'f', pointer: 'p' } },
        ],
      }),
    ]);
    const { input, ctx } = inputFor(registerUsecase(), domain);

    expect(planResolutionVerifier.verify(input, ctx)).toEqual([]);
  });

  it('触らない集約の不変条件は関係がない(交わりで絞る)', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-OTHER-001',
        entities: ['owner'],
        enforcedBy: [{ kind: 'application', ref: 'assertOther', location: { file: 'f', pointer: 'p' } }],
      }),
    ]);
    const { input, ctx } = inputFor(registerUsecase(), domain);

    expect(planResolutionVerifier.verify(input, ctx)).toEqual([]);
  });

  it('involves で名指しした別集約も交わりに数える', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-ITEM-002',
        entities: ['owner'],
        involves: ['container'],
        enforcedBy: [{ kind: 'application', ref: 'assertItem', location: { file: 'f', pointer: 'p' } }],
      }),
    ]);
    const { input, ctx } = inputFor(registerUsecase(), domain);

    const findings = planResolutionVerifier.verify(input, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ invariant: 'INV-ITEM-002', entities: 'container' });
  });

  it('理由つきで受け入れれば warning ごと出ない(免除リストは作らない)', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-ITEM-001',
        entities: ['item'],
        enforcedBy: [{ kind: 'application', ref: 'assertItem', location: { file: 'f', pointer: 'p' } }],
      }),
    ]);
    const usecase = {
      ...registerUsecase(),
      accept: [usecaseAcceptInvariant('INV-ITEM-001', 'この保存点は行を作るだけで合計を変えない')],
    };
    const { input, ctx } = inputFor(usecase, domain);

    expect(planResolutionVerifier.verify(input, ctx)).toEqual([]);
  });

  it('db_constraint / trigger で守る不変条件は母集合に入らない(DB が守っている)', () => {
    const domain = withInvariants([
      invariant({
        id: 'INV-ITEM-003',
        entities: ['item'],
        enforcedBy: [{ kind: 'db_constraint', ref: 'chk_item', location: { file: 'f', pointer: 'p' } }],
      }),
    ]);
    const { input, ctx } = inputFor(registerUsecase(), domain);

    expect(planResolutionVerifier.verify(input, ctx)).toEqual([]);
  });
});
