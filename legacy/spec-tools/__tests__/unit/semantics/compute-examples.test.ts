/**
 * 計算値の例の表の意味の導出(`semantics/compute-examples.ts`)のテスト。
 * 3 か所(生成テスト・test_cases の生成ブロック・ブックの早見表)が同じ読みを使うので、
 * 並び・通し番号・数え方・守っている不変条件の引き方をここで固定する。
 */

import { describe, expect, it } from 'vitest';
import {
  computeExampleCount,
  computeExampleKey,
  computeExampleOpOf,
  computeExampleTable,
  computeExampleSets,
  computeExampleSpecIds,
  invariantsEnforcedBy,
} from '../../../lib/semantics/compute-examples.js';
import type { ActionComputeExample } from '../../../lib/model/trace/types.js';
import { aggregate, entitySpec, field, invariant, invariantSpec, specModel } from '../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 例 1 行。 */
function row(note: string): ActionComputeExample {
  return { note, facts: {}, input: {}, expect: 1, location: { file: 'x.md' } };
}

const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'line',
      entity: entitySpec('line', [field('fee', { kind: 'integer' })]),
      invariants: invariantSpec([
        invariant({ id: 'INV-LINE-001', entities: ['line'], enforcedBy: [{ kind: 'application', ref: 'feeOf', location: { file: 'x.md' } }] }),
        invariant({ id: 'INV-LINE-002', entities: ['line'], enforcedBy: [{ kind: 'trigger', ref: 'feeOf', location: { file: 'x.md' } }] }),
        invariant({ id: 'INV-LINE-003', entities: ['line'], enforcedBy: [{ kind: 'application', ref: 'feeOf', location: { file: 'x.md' } }] }),
      ]),
    }),
  ],
});

describe('computeExampleSets', () => {
  const actions = [
    actionSpec({ handles: 'line.none', computes: { 'line.fee': 'noneOf' } }),
    actionSpec({
      handles: 'line.edit',
      computes: { 'line.fee': 'feeOf', 'line.tax': 'taxOf', 'line.memo': 'memoOf' },
      computeExamples: { 'line.fee': [row('a'), row('b')], 'line.memo': [row('c')] },
    }),
    actionSpec({ handles: 'line.settle', computes: { 'line.fee': 'settleOf' }, computeExamples: { 'line.fee': [row('d')] } }),
  ];
  const sets = computeExampleSets(actions);

  it('例を持つ computes だけを、操作の並び → 宣言順で返す', () => {
    expect(sets.map((set) => `${set.op}:${set.decl.ref}`)).toEqual(['line.edit:feeOf', 'line.edit:memoOf', 'line.settle:settleOf']);
  });

  it('通し番号は操作の中で宣言順に 1 から(複数の computes が例を持てば続ける)。次の操作でまた 1 から', () => {
    expect(sets.map((set) => set.examples.map((entry) => entry.index))).toEqual([[1, 2], [3], [1]]);
  });

  it('行の数が必読に数える公理の本数になる', () => {
    expect(computeExampleCount(sets)).toBe(4);
    expect(computeExampleCount([])).toBe(0);
  });
});

describe('守っている仕様 ID', () => {
  const [set] = computeExampleSets([
    actionSpec({ handles: 'line.edit', computes: { 'line.fee': 'feeOf' }, computeExamples: { 'line.fee': [row('a')] } }),
  ]);

  it('その関数を application の執行点にしている不変条件(宣言順)。trigger の ref は数えない', () => {
    expect(invariantsEnforcedBy(MODEL, 'feeOf')).toEqual(['INV-LINE-001', 'INV-LINE-003']);
    expect(invariantsEnforcedBy(MODEL, 'unknownOf')).toEqual([]);
  });

  it('spec_ids は 操作 + 不変条件', () => {
    expect(set).toBeDefined();
    expect(computeExampleSpecIds(MODEL, set!)).toEqual(['line.edit', 'INV-LINE-001', 'INV-LINE-003']);
  });
});

describe('例の行の写し(spec:diff が比べる元)', () => {
  const nested: ActionComputeExample = {
    note: '入れ子',
    facts: { 'line.b': [1, { y: 2, x: 1 }], 'line.a': null },
    input: { z: 'text', k: true },
    expect: { out: [{ b: 2, a: 1 }] },
    location: { file: 'x.md' },
  };

  it('鍵は 操作/純関数/行の名前 で、操作を鍵の先頭から取り出せる', () => {
    const [set] = computeExampleSets([
      actionSpec({ handles: 'line.edit', computes: { 'line.fee': 'feeOf' }, computeExamples: { 'line.fee': [row('a')] } }),
    ]);

    expect(computeExampleKey(set!, row('a'))).toBe('line.edit/feeOf/a');
    expect(computeExampleOpOf('line.edit/feeOf/a/b')).toBe('line.edit');
    expect(computeExampleOpOf('no-slash')).toBe('no-slash');
  });

  it('字面は鍵の順に依らず(入れ子・配列の中も)、facts_input は facts と input を、input は input だけを写す', () => {
    const facts = computeExampleTable([
      actionSpec({ handles: 'line.edit', computes: { 'line.fee': 'feeOf' }, computeExamples: { 'line.fee': [nested] } }),
    ]);
    const input = computeExampleTable([
      actionSpec({
        handles: 'line.edit',
        computes: { 'line.fee': 'feeOf' },
        computeShapes: { 'line.fee': 'input' },
        computeExamples: { 'line.fee': [nested] },
      }),
    ]);

    expect(facts).toEqual({
      'line.edit/feeOf/入れ子':
        '{"facts":{"line.a":null,"line.b":[1,{"x":1,"y":2}]},"input":{"k":true,"z":"text"}} → {"out":[{"a":1,"b":2}]}',
    });
    expect(input).toEqual({ 'line.edit/feeOf/入れ子': '{"input":{"k":true,"z":"text"}} → {"out":[{"a":1,"b":2}]}' });
  });

  it('例の無い操作は表に出ない', () => {
    expect(computeExampleTable([actionSpec({ handles: 'line.none', computes: { 'line.fee': 'noneOf' } })])).toEqual({});
  });
});
