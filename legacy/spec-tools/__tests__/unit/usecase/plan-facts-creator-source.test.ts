/**
 * 保存点の中で作った行の欄の供給元(`plan-facts.ts` の `insideSource`)が、実行計画の引数と**同じ規約**で決まることの規約網羅テスト。
 *
 * 点検 10 回目 A10-3: ここだけに「必須で入力に無い実行者への参照は作成者」の推測が残っていた(9 回目に計画の側からは無くした)。
 * `computes` で決まる欄も「実行者」と読み、縛りを解く規則のもとで後の手順の binding / ガードの予測が DB の判定とずれた。
 * いまは出どころの許可表(`param-source-fields.ts`)をそのまま呼ぶので、実行者で埋まるのは `owner` の明示と「自分として」だけである。
 *
 * 組み立ては生成器・検査と同じ入口(`buildSavePlans`)を通す。
 */

import { describe, expect, it } from 'vitest';
import { buildSavePlans } from '../../../lib/usecase/plan-build.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { create } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** container の作成の規則に、作る行の持ち主の欄を読むガードを置いたドメイン。 */
function guardedDomain(): SpecModel {
  const domain = rpcDomain();
  const container = domain.aggregates.get('container');
  const access = container?.access;
  if (container === undefined || access === undefined) throw new Error('container が無い');
  const aggregates = new Map(domain.aggregates);
  aggregates.set('container', { ...container, access: { ...access, creates: [create('member', 'container.owner_id == actor.id')] } });
  return { ...domain, aggregates };
}

/** container.create の action_spec だけを差し替える。 */
function withContainerCreate(init: Parameters<typeof actionSpec>[0]): ActionSpecModel {
  const base = rpcActions();
  return { ...base, actions: base.actions.map((action) => (action.handles.raw === 'container.create' ? actionSpec(init) : action)) };
}

/** container.create を 1 手順だけ持つ保存点を組み立てる。 */
function build(actions: ActionSpecModel, defaultsSelf = false) {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', [usecaseStep('container.create', { defaultsSelf })], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  return buildSavePlans({
    domain: guardedDomain(),
    guards: createGuardServices(),
    actions,
    dataTables: rpcDataTables(),
    usecases: { available: true, usecases: [usecase] },
  });
}

/** ガードが読む container.owner_id の供給元(問題があれば null)。 */
function ownerSource(built: ReturnType<typeof build>) {
  return built.saves[0]?.facts.steps[0]?.guardFacts.find((fact) => fact.variable === 'container.owner_id')?.source ?? null;
}

describe('保存点の中で作った行の欄の供給元(A10-3)', () => {
  it.each([
    {
      name: 'owner で明示した持ち主の欄は実行者',
      actions: withContainerCreate({ handles: 'container.create', input: ['container.title'], owner: 'container.owner_id' }),
      defaultsSelf: false,
      source: { kind: 'actor' },
    },
    {
      name: '入力に出した欄は入力',
      actions: withContainerCreate({ handles: 'container.create', input: ['container.title', 'container.owner_id'] }),
      defaultsSelf: false,
      source: { kind: 'input', step: 0, field: 'owner_id' },
    },
    {
      name: '「自分として」(defaults.self)は実行者',
      actions: withContainerCreate({ handles: 'container.create', input: ['container.title', 'container.owner_id'] }),
      defaultsSelf: true,
      source: { kind: 'actor' },
    },
  ])('$name', ({ actions, defaultsSelf, source }) => {
    const built = build(actions, defaultsSelf);

    expect(built.problems).toEqual([]);
    expect(ownerSource(built)).toEqual(source);
  });

  it('computes で決まる必須の実行者への参照は、実行者と読まずに接地できない道として止める(以前は推測で実行者と読んだ)', () => {
    const built = build(withContainerCreate({ handles: 'container.create', input: ['container.title'], computes: { 'container.owner_id': 'pickOwner' } }));

    expect(ownerSource(built)).toBeNull();
    expect(built.problems.map(({ stage, problem }) => [stage, problem.message])).toContainEqual(['facts', expect.stringContaining('container.owner_id の供給元が決まりません')]);
  });
});
