/**
 * 「計画だけでは足りない」の印(`lib/usecase/operation-plan-marks.ts`。束 ⑰ / ⑰-3b)。
 *
 * A15 は `runner: manual` を逆からも見る(導出できてしまったら error)。その指摘から外れる
 * ための印は**仕様側の宣言から機械が読むもの**だけであり、ここが固定するのはその境界である。
 *
 * とくに `errors.additional` は、束 ⑰-3 では「空でない」だけを見ていた —— 実行器が既に返す
 * 名前を 1 行書き足すだけで検査を黙らせられる白紙の免除口だった(独立レビュー 4-A)。
 * いまは**実行器が返せる結末の値域の外**であることまで見る。
 */

import { describe, expect, it } from 'vitest';
import { crossAggregateHooks, hasExtraErrors } from '../../../lib/usecase/operation-plan-marks.js';
import type { ActionSpec } from '../../../lib/model/trace/types.js';
import type { EnforcementDef } from '../../../lib/model/types.js';
import type { SavePlan } from '../../../lib/usecase/step-plan.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import {
  aggregate,
  entitySpec,
  invariant,
  invariantSpec,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

/** 執行点の宣言 1 つ(場所は反例の文面にだけ出るので固定でよい)。 */
function enforcement(kind: EnforcementDef['kind'], ref: string): EnforcementDef {
  return { kind, ref, location: { file: 'docs/specs/domain/test/invariants.md', pointer: 'enforced_by' } };
}

/** `errors.additional` に 1 行だけ持つ action_spec。 */
function withExtraError(kind: string): ActionSpec {
  const base = actionSpec({ handles: 'widget.send', input: ['widget.id'] });
  return {
    ...base,
    errors: {
      inherits: 'common',
      additional: [{ kind, when: 'そのとき', location: { file: 'x.md', pointer: 'errors.additional[0]' } }],
    },
  };
}

describe('実行器が返せない失敗の宣言(errors.additional)', () => {
  it('値域の外の名前は「定型の外で何かを実行している」の印になる', () => {
    expect(hasExtraErrors(withExtraError('external_unavailable'))).toBe(true);
  });

  it('実行器が既に返す名前を書き足しただけでは印にならない', () => {
    for (const kind of ['conflict', 'forbidden', 'guard_unsatisfied', 'invalid_input', 'invariant_violated', 'not_found']) {
      expect(hasExtraErrors(withExtraError(kind))).toBe(false);
    }
  });

  it('宣言が無ければ印は立たない', () => {
    expect(hasExtraErrors(actionSpec({ handles: 'widget.send', input: ['widget.id'] }))).toBe(false);
  });
});

/** 手順 1 つの計画(単発)の最小形。 */
function singleStepPlan(entity: string): SavePlan {
  return { single: true, steps: [{ entity }] } as unknown as SavePlan;
}

describe('自集約の外を参照する application 執行の不変条件', () => {
  const domain = specModel({
    aggregates: [
      aggregate({
        name: 'widget',
        entity: entitySpec('widget', []),
        invariants: invariantSpec([
          invariant({
            id: 'INV-W-001',
            entities: ['widget'],
            enforcedBy: [enforcement('application', 'assertX')],
          }),
          invariant({
            id: 'INV-W-002',
            entities: ['widget', 'gadget'],
            enforcedBy: [enforcement('application', 'assertY')],
          }),
        ]),
      }),
    ],
  });

  it('自集約だけを見る不変条件は印にならない(入力から判定できる)', () => {
    expect(crossAggregateHooks(singleStepPlan('widget'), ['INV-W-001'], domain)).toEqual([]);
  });

  it('別の集約を参照する不変条件は印になる(入力だけを見る hooks では判定できない)', () => {
    expect(crossAggregateHooks(singleStepPlan('widget'), ['INV-W-002'], domain)).toEqual(['INV-W-002']);
  });

  it('その計画が実行しない不変条件は見ない', () => {
    expect(crossAggregateHooks(singleStepPlan('widget'), [], domain)).toEqual([]);
  });

  it('保存点(単発でない)には印を置かない(数える相手をその保存点自身が書く)', () => {
    const save = { single: false, steps: [{ entity: 'widget' }] } as unknown as SavePlan;
    expect(crossAggregateHooks(save, ['INV-W-002'], domain)).toEqual([]);
  });
});
