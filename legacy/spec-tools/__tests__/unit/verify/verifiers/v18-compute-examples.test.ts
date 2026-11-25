/**
 * V18 の下位検査(計算値の例の表)の規約網羅テスト。
 * 対象の要求(action-spec-writing.md §computes の「例の表」):
 *   材料の範囲(facts の鍵は reads の中)・入力の実在・値の型・重複なし・形の整合
 *   (`shape: input` は facts を持たない)・名前の字・量の上限・ref ごとに 1 か所。
 */

import { describe, expect, it } from 'vitest';
import { computesVerifier } from '../../../../lib/verify/verifiers/v18-computes.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import type { ActionComputeExample, ComputeExampleValue } from '../../../../lib/model/trace/types.js';
import { accessSpec, aggregate, entitySpec, field, specModel, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const FILE = 'docs/specs/backend/actions/line/edit.md';

/** 行(line)の編集の計算値として料金(fee)を書く形(計算で決まる列は writes に並べない。V18)。催し(show)は材料を読まれる側。 */
const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'line',
      entity: entitySpec('line', [
        field('fee', { kind: 'integer' }),
        field('paid', { kind: 'boolean' }),
        field('code', { kind: 'string' }),
      ]),
      access: accessSpec('line', { writes: [writeRule('staff', ['paid', 'code'])] }),
    }),
    aggregate({
      name: 'show',
      entity: entitySpec('show', [field('unit', { kind: 'integer' }), field('open', { kind: 'boolean' })]),
    }),
  ],
});

/** 例 1 行(given は事実と入力。location は固定)。 */
function example(
  note: string,
  given: { facts?: Readonly<Record<string, ComputeExampleValue>>; input?: Readonly<Record<string, ComputeExampleValue>> },
  expectValue: ComputeExampleValue,
): ActionComputeExample {
  return { note, facts: given.facts ?? {}, input: given.input ?? {}, expect: expectValue, location: { file: FILE, pointer: `examples.${note}` } };
}

/** 例の表つきの computes を 1 つ宣言した action_spec だけを持つ文脈。 */
function ctx(init: {
  examples: readonly ActionComputeExample[];
  shape?: 'facts_input' | 'input';
  more?: readonly { handles: string; ref: string; examples: readonly ActionComputeExample[] }[];
}): VerifyContext {
  return {
    guards: undefined as never,
    roots: TEST_ROOTS,
    actions: loadedInput({
      actions: [
        actionSpec({
          handles: 'line.edit',
          input: ['line.paid', 'line.code'],
          computes: { 'line.fee': 'feeOf' },
          computeReads: { 'line.fee': ['show.unit', 'line.paid'] },
          computeShapes: { 'line.fee': init.shape ?? 'facts_input' },
          computeExamples: { 'line.fee': init.examples },
        }),
        ...(init.more ?? []).map((extra) =>
          actionSpec({
            handles: extra.handles,
            computes: { 'line.fee': extra.ref },
            computeExamples: { 'line.fee': extra.examples },
          }),
        ),
      ],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    }),
    dataTables: UNSELECTED,
  };
}

/** V18 の指摘のうち、例の表に関するものの文面。 */
function messages(context: VerifyContext): string[] {
  return computesVerifier
    .verify(MODEL, context)
    .map((finding) => finding.message)
    .filter((message) => message.includes('例') || message.includes('note') || message.includes('given'));
}

describe('V18 計算値の例の表', () => {
  it('材料・入力・値が揃った例は通す', () => {
    const rows = [
      example('支払い済み', { facts: { 'show.unit': 500, 'line.paid': false }, input: { paid: true } }, 500),
      example('触れない', { facts: { 'show.unit': null } }, null),
    ];

    expect(computesVerifier.verify(MODEL, ctx({ examples: rows }))).toEqual([]);
  });

  it('reads に並んでいない事実を渡す例は落とす', () => {
    const found = messages(ctx({ examples: [example('読まない事実', { facts: { 'show.open': true } }, 1)] }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('show.open は、その computes の reads に並んでいません');
  });

  it('操作の input に無い欄を入力に渡す例は落とす', () => {
    const found = messages(ctx({ examples: [example('入力に無い欄', { input: { fee: 10 } }, 1)] }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('入力 fee は、この操作の input にありません');
  });

  it('値が欄の型に合わなければ落とす(事実・入力・expect のそれぞれ)', () => {
    const found = messages(
      ctx({
        examples: [
          example('事実の型', { facts: { 'show.unit': 'x' } }, 1),
          example('入力の型', { input: { paid: 'yes' } }, 2),
          example('期待の型', {}, 1.5),
          example('期待が真偽', { facts: { 'show.unit': 1 } }, true),
        ],
      }),
    );

    expect(found).toHaveLength(4);
    expect(found[0]).toContain('事実 show.unit の値が欄の型に合いません');
    expect(found[1]).toContain('入力 paid の値が欄の型に合いません');
    expect(found[2]).toContain('expect が欄の型に合いません');
    expect(found[3]).toContain('expect が欄の型に合いません');
  });

  it('文字列の欄は文字列で書く', () => {
    const found = messages(ctx({ examples: [example('文字列の欄', { input: { code: 5 } }, 1)] }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('入力 code の値が欄の型に合いません');
  });

  it('note の重複と、同じ given の重複は落とす', () => {
    const found = messages(
      ctx({
        examples: [
          example('同じ名前', { input: { paid: true } }, 1),
          example('同じ名前', { input: { paid: false } }, 2),
          example('同じ入力', { input: { paid: false } }, 3),
        ],
      }),
    );

    expect(found).toHaveLength(2);
    expect(found[0]).toContain('note「同じ名前」が重複しています');
    expect(found[1]).toContain('同じ given の行がすでにあります');
  });

  it('given の鍵の順が違うだけの同じ入力も重複として落とす', () => {
    const found = messages(
      ctx({
        examples: [
          example('一つめ', { facts: { 'show.unit': 1, 'line.paid': true } }, 1),
          example('二つめ', { facts: { 'line.paid': true, 'show.unit': 1 } }, 2),
        ],
      }),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('同じ given の行がすでにあります');
  });

  it('note に YAML の平文を壊す字(: # 先頭の記号)があれば落とす', () => {
    const found = messages(
      ctx({
        examples: [
          example('名前: コロン', { input: { paid: true } }, 1),
          example('名前 #印', { input: { paid: false } }, 2),
          example('- 先頭の記号', { facts: { 'show.unit': 3 } }, 3),
          example('全角：は通る', { facts: { 'show.unit': 4 } }, 4),
        ],
      }),
    );

    expect(found).toHaveLength(3);
    expect(found.every((message) => message.includes('使えない字があります'))).toBe(true);
  });

  it('shape: input の例に facts を書けば落とす。入力と expect は欄と突き合わせない', () => {
    const rows = [
      example('入れ子の入力', { input: { nested: { deep: [1, 2] } } }, { total: 3 }),
      example('事実つき', { facts: { 'show.unit': 1 }, input: { other: 1 } }, { total: 1 }),
    ];
    const found = messages(ctx({ examples: rows, shape: 'input' }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('shape: input なので、例に facts は書けません');
  });

  it('shape: input の expect は葉まで 1 値以上を持つ(空のマッピングは落とす。null と空配列は主張になる)', () => {
    const rows = [
      example('空', { input: { a: 1 } }, {}),
      example('空の入れ子', { input: { a: 2 } }, { total: {} }),
      example('空のマッピングの配列', { input: { a: 3 } }, [{}]),
      example('値あり', { input: { a: 4 } }, { total: 0 }),
      example('null は主張', { input: { a: 5 } }, null),
      example('空配列は長さの主張', { input: { a: 6 } }, { items: [] }),
    ];
    const found = messages(ctx({ examples: rows, shape: 'input' }));

    expect(found).toHaveLength(3);
    expect(found.every((message) => message.includes('expect が空です'))).toBe(true);
    expect(found.join('\n')).toContain('「空」');
    expect(found.join('\n')).toContain('「空の入れ子」');
    expect(found.join('\n')).toContain('「空のマッピングの配列」');
  });

  it('同じ ref の例を 2 つの欄に書けば、2 つ目を落とす', () => {
    const rows = [example('一つめ', { input: { paid: true } }, 1)];
    const found = messages(
      ctx({ examples: rows, more: [{ handles: 'line.settle', ref: 'feeOf', examples: [example('重ね書き', {}, 2)] }] }),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('同じ ref feeOf の例が line.edit の line.fee にすでにあります');
  });

  it('別の ref なら同じ欄名に例があっても通す', () => {
    const rows = [example('一つめ', { input: { paid: true } }, 1)];
    const found = messages(
      ctx({ examples: rows, more: [{ handles: 'line.settle', ref: 'otherOf', examples: [example('別の関数', {}, 2)] }] }),
    );

    expect(found).toEqual([]);
  });

  it('1 つの操作に 99 行を超える例は落とす', () => {
    const rows = Array.from({ length: 100 }, (_, index) => example(`行 ${index}`, { facts: { 'show.unit': index } }, index));
    const found = messages(ctx({ examples: rows }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('例の行が 100 本あります');
  });

  it('例を持たない computes は見ない', () => {
    expect(messages(ctx({ examples: [] }))).toEqual([]);
  });
});
