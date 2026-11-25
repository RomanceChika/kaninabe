/**
 * V16(enum の表示名)の規約網羅テスト。
 * 対象の要求(domain-spec-writing.md §entity_spec):
 *   `enum(...)` の欄がどれかの action_spec の `input` に現れるなら `labels` は必須で、
 *   キー集合は enum の値集合と一致する。入力に現れない enum の `labels` は任意。
 */

import { describe, expect, it } from 'vitest';
import { enumLabelsVerifier } from '../../../../lib/verify/verifiers/v16-enum-labels.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { blockedInput, loadedInput, NO_DOMAIN_INPUTS, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** `entry.kind` を入力に持つ action_spec だけがある文脈。 */
function ctxWithInput(input: readonly string[]): VerifyContext {
  return {
    guards: undefined as never,
    roots: TEST_ROOTS,
    actions: loadedInput({
      actions: [actionSpec({ handles: 'entry.create', input })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    }),
    dataTables: UNSELECTED,
  };
}

/** `kind` を持つ entry 集約だけのモデル。 */
function modelWithKind(labels?: Readonly<Record<string, string>>) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field(
            'kind',
            { kind: 'enum', values: ['performance', 'audience'] },
            labels === undefined ? {} : { labels },
          ),
        ]),
      }),
    ],
  });
}

describe('V16 enum の表示名', () => {
  it('入力に現れない enum は labels が無くても通す', () => {
    expect(enumLabelsVerifier.verify(modelWithKind(), ctxWithInput([]))).toEqual([]);
  });

  it('入力に現れる enum に labels が無ければ反例つきで落とす', () => {
    const findings = enumLabelsVerifier.verify(modelWithKind(), ctxWithInput(['entry.kind']));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'V16',
      severity: 'error',
      counterexample: { entity: 'entry', field: 'kind', values: 'performance, audience' },
    });
  });

  it('labels が全値を覆っていれば通す', () => {
    const model = modelWithKind({ performance: '発表枠', audience: '聴講者参加' });

    expect(enumLabelsVerifier.verify(model, ctxWithInput(['entry.kind']))).toEqual([]);
  });

  it('labels に足りない値があれば落とす(入力に現れなくても見る)', () => {
    const model = modelWithKind({ performance: '発表枠' });

    const findings = enumLabelsVerifier.verify(model, ctxWithInput([]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing: 'audience' });
  });

  it('labels に enum の値でないキーがあれば落とす', () => {
    const model = modelWithKind({ performance: '発表枠', audience: '聴講者参加', staff: '運営' });

    const findings = enumLabelsVerifier.verify(model, ctxWithInput([]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ extra: 'staff' });
  });

  it('action_spec を読めていない構成では「必須」を課さない', () => {
    expect(enumLabelsVerifier.verify(modelWithKind(), { roots: TEST_ROOTS, guards: undefined as never, ...NO_DOMAIN_INPUTS })).toEqual([]);
  });
});

describe('V16 入力の状態(action_spec が未選択 / 阻害 / 読込済み 0 件)', () => {
  const unlabeled = () => modelWithKind();

  it('未選択: 入力に現れる欄は事実として無いので「必須」を課さない(labels が足りない・余る判定は従来どおり見る)', () => {
    const ctx = { ...ctxWithInput([]), actions: UNSELECTED };

    expect(enumLabelsVerifier.verify(unlabeled(), ctx)).toEqual([]);
    expect(enumLabelsVerifier.verify(modelWithKind({ performance: '発表枠' }), ctx)).toHaveLength(1);
  });

  it('阻害: 入力に現れるか分からないので「必須」の判定は出さない(同じ入力が読込済みなら出る)', () => {
    const blocked = { ...ctxWithInput([]), actions: blockedInput<never>('load-failed') };

    expect(enumLabelsVerifier.verify(unlabeled(), blocked)).toEqual([]);
    expect(enumLabelsVerifier.verify(unlabeled(), ctxWithInput(['entry.kind']))).toHaveLength(1);
    // labels の中身の判定は action_spec に依らないので、阻害でも出す。
    expect(enumLabelsVerifier.verify(modelWithKind({ performance: '発表枠' }), blocked)).toHaveLength(1);
  });

  it('読込済み 0 件(action_spec が 1 件も無い): 入力に現れる欄は無いので「必須」を課さない', () => {
    const empty = { ...ctxWithInput([]), actions: loadedInput({ actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }) };

    expect(enumLabelsVerifier.verify(unlabeled(), empty)).toEqual([]);
  });
});

