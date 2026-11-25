/**
 * action_spec の `test_cases` のうち、**計算値の例の表のテストを指す行**の生成器。
 *
 * `action-test-cases.ts` と同じ形(フロントマターの YAML コメントの印の中だけを生成する)で、
 * 印の名前だけが違う。実行計画から生成する場面(901〜)とは別のブロックにするのは、
 * 2 つの生成器が同じ印を書くと後の方が先の方を上書きするためである。
 * 例の表を持つ `computes` を宣言した操作の仕様に、印(`# AUTO-GENERATED:action-compute-examples`)を
 * 1 組置く。**印が無ければ書かれず**、テストの注釈だけが仕様に載らない行として A6 が名指す。
 *
 * 規約どおりファイル I/O はしない純粋関数。
 */

import type { SpecModel } from '../../model/types.js';
import { specPath } from '../../model/product/paths.js';
import { computeExampleSets, computeExampleSpecIds, type ComputeExampleSet } from '../../semantics/compute-examples.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { computeExampleTcIdOf } from './compute-examples-names.js';
import { computeExampleTestPlacerOf } from './test-placement.js';

/** 生成ブロックの印の名前。 */
export const ACTION_COMPUTE_EXAMPLES_MARKER = 'action-compute-examples';

/** 全 action_spec の例の表のテストケースを書き出すジェネレーター。 */
export const actionComputeExampleCasesGenerator: DocGenerator = {
  id: 'action-compute-example-cases',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = computeExampleTestPlacerOf(ctx);
    if (place === null) return [];
    const byOperation = new Map<string, ComputeExampleSet[]>();
    for (const set of computeExampleSets(ctx.actions?.actions ?? [])) {
      byOperation.set(set.op, [...(byOperation.get(set.op) ?? []), set]);
    }
    return [...byOperation.values()].flatMap((sets) => {
      const [first] = sets;
      if (first === undefined) return [];
      return [
        {
          file: specPath(ctx.roots, `backend/actions/${first.relPath}`),
          marker: ACTION_COMPUTE_EXAMPLES_MARKER,
          content: sets.flatMap((set) => renderCases(model, set, place(set.decl.ref))).join('\n'),
        },
      ];
    });
  },
};

/** 例の表 1 枚ぶんのテストケース(フロントマターの並びに収まる字下げで出す)。 */
function renderCases(model: SpecModel, set: ComputeExampleSet, testFile: string): string[] {
  const specIds = computeExampleSpecIds(model, set).join(', ');
  return set.examples.map(({ index, example }) =>
    [
      `  - id: ${computeExampleTcIdOf(set.op, index)}`,
      '    type: unit',
      '    covers: [other]',
      `    spec_ids: [${specIds}]`,
      `    implementation: ${testFile}::${example.note}`,
    ].join('\n'),
  );
}
