/**
 * Y4(保存点の原子性の前提)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「保存点の内側で作った実体の初期状態が、同じ保存点内の
 * 後続の遷移の from に入っている」。
 */

import { describe, expect, it } from 'vitest';
import { saveAtomicityVerifier } from '../../../../lib/usecase/verifiers/y4-save-atomicity.js';
import { accessSpec, aggregate, create, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { USECASE_CTX, testDomain, usecaseInput } from '../_fixtures.js';

describe('Y4 保存点の原子性の前提', () => {
  it('作成の初期状態が同じ保存点内の遷移の from にあれば通る(entry.create → draft → submit)', () => {
    const usecase = usecaseSpec({
      saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(saveAtomicityVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('作成の初期状態が同じ保存点内の遷移の from に無いと違反になる', () => {
    // item の初期状態を "queued" にし、submit の from は ["draft"] のまま(食い違いを作る)。
    const base = testDomain();
    const domain = specModel(
      [
        ...[...base.aggregates.values()].filter((a) => a.name !== 'item'),
        aggregate('item', {
          entity: entitySpec('item', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('item', { creates: [create('member')] }),
          stateMachines: [
            machine('item', {
              states: ['queued', 'draft', 'submitted'],
              initial: 'queued',
              events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
            }),
          ],
        }),
      ],
      base.roles,
    );
    const usecase = usecaseSpec({
      saves: [usecaseSave('register', [usecaseStep('item.create'), usecaseStep('item.submit')])],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] }, domain });

    const findings = saveAtomicityVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y4');
    expect(findings[0]?.counterexample).toMatchObject({ op: 'item.submit', initial: 'queued' });
  });

  it('作成が別の保存点にあるなら(保存点をまたぐ)指摘しない', () => {
    const usecase = usecaseSpec({
      saves: [
        usecaseSave('create', [usecaseStep('item.create')]),
        usecaseSave('submit', [usecaseStep('item.submit')]),
      ],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(saveAtomicityVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });
});
