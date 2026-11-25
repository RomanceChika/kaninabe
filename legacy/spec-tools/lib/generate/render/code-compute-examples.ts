/**
 * 計算値の例の表(`computes[].examples`)→ **ユニットテスト**
 * (`app/src/operation/__tests__/generated/computes/{ref}.examples.test.ts`)の生成器。
 *
 * ## なぜ生成するのか
 *
 * 計算値の式は純関数のまま DSL の外に置く(domain-spec-writing.md「DSL の外に置くもの」)。式は
 * 仕様から読めないので、**人が読める形で「この入力ならこの値」を宣言させ、実際の関数と突き合わせる**。
 * 例は仕様の側に(人が読む表として)あり、テストは生成物なので、例を直せばテストも変わる ——
 * 同じ例を 2 か所に書き写す状態が生まれない。**一致しなければ、式か例のどちらかが間違っている**
 * (どちらが正かは仕様の規則に照らして人が決める。テストは決めない)。
 *
 * ## 形
 *
 * 純関数 1 本につき 1 ファイル・例の行ごとに `it()` 1 本。呼び口の形は宣言(`shape`)が決める
 * (関数の署名から推測しない): `facts_input` は `ref(facts, input)`、`input` は `ref(input)`。
 * 戻り値が入れ子の値になる `input` の形は、**書いた鍵だけ**を照合する(`toMatchObject`。
 * 早見表に載せたい値だけを主張できる)。それ以外は全体が一致する(`toEqual`)。
 * 純関数は生成物ではないので、本物を手書きの純関数の置き場(配置の役割 `computes-module`)から import して実行する。
 *
 * 規約どおりファイル I/O はしない純粋関数。
 */

import type { SpecModel } from '../../model/types.js';
import { COMPUTE_EXAMPLE_TITLES } from '../../messages/messages.js';
import { specPath } from '../../model/product/paths.js';
import { computeExampleSets, computeExampleSpecIds, type ComputeExampleSet } from '../../semantics/compute-examples.js';
import type { DocGenerator, GenerateContext, GeneratedSection } from '../../gen-kit/generator.js';
import { computeExampleTcIdOf } from './compute-examples-names.js';
import { generatedHeader, renderLiteral, tsString, type LiteralValue } from '../../gen-kit/code-emit.js';
import { bodyModulesOf } from '../body-modules.js';
import { computeExampleTestPlacerOf } from './test-placement.js';

/** 全 action_spec の例の表からユニットテストを生成するジェネレーター。 */
export const computeExamplesGenerator: DocGenerator = {
  id: 'code-compute-examples',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = computeExampleTestPlacerOf(ctx);
    if (place === null) return [];
    return computeExampleSets(ctx.actions?.actions ?? []).map((set) => ({
      file: place(set.decl.ref),
      content: renderTestFile(model, ctx, set),
      wholeFile: true,
    }));
  },
};

/** テストファイル 1 本(純関数 1 本ぶんの例)。 */
function renderTestFile(model: SpecModel, ctx: GenerateContext, set: ComputeExampleSet): string {
  const { ref } = set.decl;
  const specIds = computeExampleSpecIds(model, set);
  const specFile = specPath(ctx.roots, `backend/actions/${set.relPath}`);
  const modules = bodyModulesOf(ctx, { what: `純関数 ${ref} の例の表のテスト`, location: { file: specFile } });
  return [
    generatedHeader([specFile]),
    '',
    "import { describe, expect, it } from 'vitest';",
    `import { ${ref} } from '${modules.computes(ref)}';`,
    '',
    `describe(${tsString(COMPUTE_EXAMPLE_TITLES.suite(ref))}, () => {`,
    ...set.examples.flatMap(({ index, example }) => renderExample(set, specIds, index, example)),
    '});',
    '',
  ].join('\n');
}

/** 例 1 行 = `it()` 1 本。 */
function renderExample(
  set: ComputeExampleSet,
  specIds: readonly string[],
  index: number,
  example: ComputeExampleSet['examples'][number]['example'],
): readonly string[] {
  const { ref, shape } = set.decl;
  const literal = (value: LiteralValue): string => renderLiteral(value, 2);
  // 入れ子の戻り値(`input` の形)は**書いた鍵だけ**照合する(早見表に載せたい値だけを主張できる)。
  // 値そのもの(スカラー・null)と、事実を受ける形の戻り値は全体が一致する。
  const nested = typeof example.expect === 'object' && example.expect !== null;
  const matcher = shape === 'input' && nested ? 'toMatchObject' : 'toEqual';
  const call =
    shape === 'input'
      ? [`    const input = ${literal(example.input)};`, `    expect(${ref}(input)).${matcher}(${literal(example.expect)});`]
      : [
          `    const facts = ${literal(example.facts)};`,
          `    const input = ${literal(example.input)};`,
          `    expect(${ref}(facts, input)).toEqual(${literal(example.expect)});`,
        ];
  return [
    `  // @spec ${specIds.join(' ')} @tc ${computeExampleTcIdOf(set.op, index)}`,
    `  it(${tsString(example.note)}, () => {`,
    ...call,
    '  });',
    '',
  ];
}
