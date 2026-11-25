/**
 * action_spec の `test_cases` のうち、**生成テストを指す行**の生成器(束 ⑰-3)。
 *
 * 仕様: docs/rules/process/backend/specification/standards/action-spec-writing.md §test_cases
 *
 * ユニットテストが生成物になった以上、「そのテストが実在する」という宣言も生成物である ——
 * 人が生成テストの名前を書き写すと、名前を変えた瞬間に A6 が落ち、直す先が 2 か所になる。
 * そこで action_spec のフロントマターに印(`# AUTO-GENERATED:action-unit-tests`)を置き、
 * その中だけを生成する。**統合テストの行は手書きのまま**印の外に残る(実 DB に対する確認は
 * 仕様から場面を作れない)。
 *
 * 印がフロントマターの中にあるので、形は HTML コメントではなく YAML のコメントである
 * (`lib/generate/markers.ts` が両方の書き方を受ける)。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { PlanScenario } from '../../usecase/plan-scenario.js';
import { operationScenarios } from './code-operation-tests.js';
import { testCaseIdOf } from './operation-test-names.js';
import { operationTestPlacerOf } from './test-placement.js';

/** 生成ブロックの印の名前。 */
export const ACTION_UNIT_TESTS_MARKER = 'action-unit-tests';

/** 全 action_spec の `test_cases` の生成ブロックを書き出すジェネレーター。 */
export const actionTestCasesGenerator: DocGenerator = {
  id: 'action-test-cases',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    // 注釈が指すのは**実装の木の中のテストファイル**なので、木を持たない製品では書けない
    // (宣言しか持たない製品では `test_cases` の生成ブロックも空になるのが正しい)。
    const place = operationTestPlacerOf(ctx);
    if (place === null) return [];
    return operationScenarios(model, ctx).map((entry) => {
      const testFile = place(entry.op);
      return {
        file: entry.specFile,
        marker: ACTION_UNIT_TESTS_MARKER,
        content: entry.scenarios.map((scenario) => renderCase(entry.op, scenario, testFile)).join('\n'),
      };
    });
  },
};

/** テストケース 1 件(フロントマターの並びに収まる字下げで出す)。 */
function renderCase(op: string, scenario: PlanScenario, testFile: string): string {
  const lines = [
    `  - id: ${testCaseIdOf(op, scenario.index)}`,
    '    type: unit',
    `    covers: [${scenario.covers.join(', ')}]`,
    ...(scenario.byRole === null ? [] : [`    by_role: ${scenario.byRole}`]),
    `    spec_ids: [${scenario.specIds.join(', ')}]`,
    `    implementation: ${testFile}::${scenario.title}`,
  ];
  return lines.join('\n');
}
