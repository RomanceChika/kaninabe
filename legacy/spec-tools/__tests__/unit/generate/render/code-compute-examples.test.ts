/**
 * 計算値の例の表 → ユニットテストの字面(`code-compute-examples.ts`)と、その行を指す action_spec の
 * 生成ブロック(`action-compute-example-cases.ts`)。名前(`compute-examples-names.ts`)も同じ表で固定する。
 *
 * ここで固定するのは仕組みの規約である ——
 *   - 純関数 1 本につき 1 ファイル・例の行ごとに `it()` 1 本で、本物の純関数(`@/domain/computes/{ref}`)を呼ぶ
 *   - 呼び口の形は宣言(`shape`)が決める(`facts_input` = `ref(facts, input)` / `input` = `ref(input)`)
 *   - 入れ子の戻り値は書いた鍵だけ照合する(`toMatchObject`)。スカラー・null は全体が一致する(`toEqual`)
 *   - `test_cases` の生成ブロックが、同じファイルの同じ名前・同じ ID を指す(A6 がすれ違わない)
 *   - 例が 1 つも無ければ何も出さない
 */

import { describe, expect, it } from 'vitest';
import { computeExamplesGenerator } from '../../../../lib/generate/render/code-compute-examples.js';
import {
  ACTION_COMPUTE_EXAMPLES_MARKER,
  actionComputeExampleCasesGenerator,
} from '../../../../lib/generate/render/action-compute-example-cases.js';
import { computeExampleTcIdOf } from '../../../../lib/generate/render/compute-examples-names.js';
import { layoutPath, layoutScan } from '../../../../lib/model/product/layout.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { ActionComputeExample, ComputeExampleValue } from '../../../../lib/model/trace/types.js';
import { aggregate, entitySpec, field, invariant, invariantSpec, specModel, stubContext } from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_PLATFORM, TEST_LAYOUT, leaksNextjsEntrySpelling } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const FILE = 'docs/specs/backend/actions/line/edit.md';

/** 例 1 行。 */
function example(
  note: string,
  given: { facts?: Readonly<Record<string, ComputeExampleValue>>; input?: Readonly<Record<string, ComputeExampleValue>> },
  expectValue: ComputeExampleValue,
): ActionComputeExample {
  return { note, facts: given.facts ?? {}, input: given.input ?? {}, expect: expectValue, location: { file: FILE } };
}

/** 関数 feeOf を執行点にした不変条件 1 本を持つモデル。 */
const DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'line',
      entity: entitySpec('line', [field('fee', { kind: 'integer' })]),
      invariants: invariantSpec([
        invariant({ id: 'INV-LINE-001', entities: ['line'], enforcedBy: [{ kind: 'application', ref: 'feeOf', location: { file: 'x.md' } }] }),
      ]),
    }),
  ],
});

/** 例の表つきの action_spec 1 本(+ 任意で別の操作)を持つ文脈。 */
function context(init: { shape?: 'facts_input' | 'input'; examples: readonly ActionComputeExample[] }): GenerateContext {
  const { guards } = stubContext();
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    actions: {
      actions: [
        actionSpec({
          handles: 'line.edit',
          computes: { 'line.fee': 'feeOf' },
          computeShapes: { 'line.fee': init.shape ?? 'facts_input' },
          computeExamples: { 'line.fee': init.examples },
        }),
        actionSpec({ handles: 'line.other', computes: { 'line.fee': 'otherOf' } }),
      ],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
  };
}

describe('名前の規約', () => {
  it('置き場・ファイル・テストケース ID は 1 か所で決まる', () => {
    expect(layoutScan(TEST_LAYOUT, 'app', 'compute-example-test')?.dir).toBe('app/src/operation/__tests__/generated/computes');
    expect(layoutPath(TEST_LAYOUT, 'app', 'compute-example-test', 'feeOf')).toBe('app/src/operation/__tests__/generated/computes/feeOf.examples.test.ts');
    expect(computeExampleTcIdOf('line.edit', 1)).toBe('TC-LINE-EDIT-801');
    expect(computeExampleTcIdOf('entry_participant.update', 12)).toBe('TC-ENTRY_PARTICIPANT-UPDATE-812');
  });
});

describe('facts_input の例の表から出るテスト', () => {
  const rows = [
    example('席代あり', { facts: { 'line.fee': 500, 'line.paid': true }, input: { paid: false } }, 500),
    example('決まらない', { facts: { 'line.fee': null } }, null),
  ];
  const sections = computeExamplesGenerator.generate(DOMAIN, context({ examples: rows }));

  it('例を持つ純関数 1 本につき 1 ファイル(全体が生成物)。例の無い純関数は出さない', () => {
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/operation/__tests__/generated/computes/feeOf.examples.test.ts');
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('生成物の印を持ち、本物の純関数を import して (facts, input) で呼び、全体の一致を見る', () => {
    const content = sections[0]?.content ?? '';

    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain(' *   - docs/specs/backend/actions/line/edit.md');
    expect(content).toContain("import { feeOf } from '@/domain/computes/feeOf';");
    expect(content).toContain("describe('feeOf の例の表(生成)', () => {");
    expect(content).toContain("it('席代あり', () => {");
    expect(content).toContain("const facts = {\n      'line.fee': 500,\n      'line.paid': true,\n    };");
    expect(content).toContain('const input = {\n      paid: false,\n    };');
    expect(content).toContain('expect(feeOf(facts, input)).toEqual(500);');
    expect(content).toContain('expect(feeOf(facts, input)).toEqual(null);');
  });

  it('注釈は 操作 + その関数を執行点にする不変条件を 1 つの @spec に空白区切りで、通し番号の ID を @tc に持つ', () => {
    const content = sections[0]?.content ?? '';

    expect(content).toContain('// @spec line.edit INV-LINE-001 @tc TC-LINE-EDIT-801');
    expect(content).toContain('// @spec line.edit INV-LINE-001 @tc TC-LINE-EDIT-802');
  });
});

describe('input の形の例の表から出るテスト', () => {
  it('関数を ref(input) で呼び、入れ子の戻り値は書いた鍵だけ照合する(toMatchObject)。スカラーは toEqual', () => {
    const rows = [
      example('入れ子', { input: { workshop: { seat: 500 }, people: [{ id: 'p1' }] } }, { total: 500 }),
      example('合計だけ', { input: { workshop: { seat: 0 } } }, 0),
    ];
    const content = computeExamplesGenerator.generate(DOMAIN, context({ shape: 'input', examples: rows }))[0]?.content ?? '';

    expect(content).toContain('expect(feeOf(input)).toMatchObject({\n      total: 500,\n    });');
    expect(content).toContain('expect(feeOf(input)).toEqual(0);');
    expect(content).not.toContain('feeOf(facts');
  });
});

describe('test_cases の生成ブロック', () => {
  const rows = [example('一つめ', { input: { paid: true } }, 1), example('二つめ', { input: { paid: false } }, 2)];
  const sections = actionComputeExampleCasesGenerator.generate(DOMAIN, context({ examples: rows }));

  it('例を持つ操作の仕様ファイルに、印の名前つきで 1 ブロックを書く', () => {
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/actions/line/edit.md');
    expect(sections[0]?.marker).toBe(ACTION_COMPUTE_EXAMPLES_MARKER);
    expect(ACTION_COMPUTE_EXAMPLES_MARKER).toBe('action-compute-examples');
  });

  it('テストと同じ ID・同じファイル・同じ名前を指す(unit・covers: other)', () => {
    expect(sections[0]?.content).toBe(
      [
        '  - id: TC-LINE-EDIT-801',
        '    type: unit',
        '    covers: [other]',
        '    spec_ids: [line.edit, INV-LINE-001]',
        '    implementation: app/src/operation/__tests__/generated/computes/feeOf.examples.test.ts::一つめ',
        '  - id: TC-LINE-EDIT-802',
        '    type: unit',
        '    covers: [other]',
        '    spec_ids: [line.edit, INV-LINE-001]',
        '    implementation: app/src/operation/__tests__/generated/computes/feeOf.examples.test.ts::二つめ',
      ].join('\n'),
    );
  });

  it('例が 1 つも無ければ何も出さない(両方の生成器)', () => {
    expect(actionComputeExampleCasesGenerator.generate(DOMAIN, context({ examples: [] }))).toEqual([]);
    expect(computeExamplesGenerator.generate(DOMAIN, context({ examples: [] }))).toEqual([]);
  });

  it('1 つの操作に例を持つ computes が 2 つあれば、番号は続けて振り 1 ブロックにまとまる', () => {
    const { guards } = stubContext();
    const both: GenerateContext = {
      guards,
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      actions: {
        actions: [
          actionSpec({
            handles: 'line.edit',
            computes: { 'line.fee': 'feeOf', 'line.tax': 'taxOf' },
            computeExamples: { 'line.fee': [example('料金', {}, 1)], 'line.tax': [example('税', {}, 2)] },
          }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const blocks = actionComputeExampleCasesGenerator.generate(DOMAIN, both);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.content).toContain('TC-LINE-EDIT-801');
    expect(blocks[0]?.content).toContain('taxOf.examples.test.ts::税');
    expect(blocks[0]?.content).toContain('TC-LINE-EDIT-802');
    // その関数を執行点にする不変条件が無ければ、守る先は操作だけ。
    expect(blocks[0]?.content).toContain('spec_ids: [line.edit]\n    implementation: app/src/operation/__tests__/generated/computes/taxOf');
  });
});

describe('例の表のテストの置き場は置き場の配置の役割 compute-example-test が決める', () => {
  it('配置を差し替えると、テストのファイルと test_cases の implementation がその配置の値になる(Next.js の綴りは残らない)', () => {
    const foreign: GenerateContext = { ...context({ examples: [example('席代あり', { facts: { 'line.fee': 500 } }, 500)] }), layout: FOREIGN_LAYOUT };
    const tests = computeExamplesGenerator.generate(DOMAIN, foreign);
    const cases = actionComputeExampleCasesGenerator.generate(DOMAIN, foreign);

    expect(tests.map((section) => section.file)).toEqual(['app/server_code/checks/pure/feeOf.table.check.ts']);
    expect(cases[0]?.content).toContain('implementation: app/server_code/checks/pure/feeOf.table.check.ts::席代あり');
    expect(layoutScan(FOREIGN_LAYOUT, 'app', 'compute-example-test')?.dir).toBe('app/server_code/checks/pure');
    expect(leaksNextjsEntrySpelling(cases[0]?.content ?? '')).toBe(false);
  });

  it('実装の木が無ければ何も出さない', () => {
    const none: GenerateContext = { ...context({ examples: [example('席代あり', { facts: { 'line.fee': 500 } }, 500)] }), roots: { ...TEST_ROOTS, app: null } };
    expect(computeExamplesGenerator.generate(DOMAIN, none)).toEqual([]);
    expect(actionComputeExampleCasesGenerator.generate(DOMAIN, none)).toEqual([]);
  });
});
