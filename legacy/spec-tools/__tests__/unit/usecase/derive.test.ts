/**
 * derive.ts(「数えた面倒」の導出)の数え方テスト。Y5 とハンドブックの章が共有する
 * 1 つの純粋関数群であり、ここでは各指標の数え方を 1 ケースずつ確かめる。
 */

import { describe, expect, it } from 'vitest';
import {
  deriveConcepts,
  derivePreconditions,
  deriveScreens,
  deriveStepCount,
} from '../../../lib/usecase/derive.js';
import { deriveAsyncOps, deriveConfirmations, deriveInputs } from '../../../lib/usecase/derive-effort.js';
import { accessSpec, aggregate, create, effect, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { testDomain, usecaseInput } from './_fixtures.js';

const VALID_STEPS = [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')];

describe('derive.ts', () => {
  it('①手数: 保存点の数(内側の手順は 1 回の保存で実行されるので数えない)', () => {
    const oneSave = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const withRepeat = usecaseSpec({
      saves: [usecaseSave('register', [...VALID_STEPS, usecaseStep('item.create', { repeat: true })])],
    });
    const twoSaves = usecaseSpec({
      saves: [usecaseSave('register', VALID_STEPS), usecaseSave('submit', [usecaseStep('item.submit')])],
    });

    expect(deriveStepCount(oneSave)).toEqual({ base: 1, stepTotal: 3, hasRepeat: false, label: '1(内側の手順 3)' });
    expect(deriveStepCount(withRepeat)).toEqual({
      base: 1,
      stepTotal: 4,
      hasRepeat: true,
      label: '1(内側の手順 4+N)',
    });
    expect(deriveStepCount(twoSaves).base).toBe(2);
  });

  it('②画面: start を含む、各手順を出す画面の重複なし合計', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const result = deriveScreens(usecase, input);

    expect(result.startReachable).toBe(true);
    expect(result.unresolvedOps).toEqual([]);
    expect([...result.screenIds].sort()).toEqual(['screen-detail', 'screen-list']);
  });

  it('③概念: 触る集約の数 + 到達する状態の数', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });

    const result = deriveConcepts(usecase, testDomain());

    expect([...result.aggregates].sort()).toEqual(['container', 'item']);
    expect(result.states).toEqual(['item.submitted']);
    expect(result.count).toBe(3);
  });

  it('⑤前提: start に入るのに要る関門の数(requires_auth)', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(derivePreconditions(usecase, input)).toEqual({ count: 1, guards: ['requires_auth'] });
  });

  it('⑥入力: 各手順の action_spec input のうち required なフィールド数の合計', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const result = deriveInputs(usecase, input);

    // container.create: title(必須) = 1 / item.create: container_id・name(必須) = 2 / item.submit: id(非必須) = 0
    expect(result.perStep).toEqual([
      { op: 'container.create', required: 1 },
      { op: 'item.create', required: 2 },
      { op: 'item.submit', required: 0 },
    ]);
    expect(result.total).toBe(3);
  });

  it('⑦確認: 戻れない(irreversible)かつ所有者以外が実行できる(affectsOthers)なら確認が要る', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    // item.submit は戻す遷移が無く(irreversible)、member(所有者以外を含む)が実行できる(affectsOthers)。
    const result = deriveConfirmations(usecase, input);

    expect(result.flaggedOps).toEqual(['item.submit']);
    expect(result.total).toBe(1);
  });

  it('⑨応答(参考): effects を持つ手順を非同期として列挙する', () => {
    const base = testDomain();
    const domain = specModel(
      [
        ...[...base.aggregates.values()].filter((a) => a.name !== 'item'),
        aggregate('item', {
          entity: entitySpec('item', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('item', { creates: [create('member')] }),
          stateMachines: [
            machine('item', {
              states: ['draft', 'submitted'],
              initial: 'draft',
              events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
              effects: [effect('submit', ['notify_owner'])],
            }),
          ],
        }),
      ],
      base.roles,
    );
    const usecase = usecaseSpec({ saves: [usecaseSave('register', [usecaseStep('item.create'), usecaseStep('item.submit')])] });

    expect(deriveAsyncOps(usecase, domain)).toEqual(['item.submit']);
  });
});
