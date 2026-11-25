/**
 * usecase_spec の `test_cases` のうち、**生成した保存点の一致の証明を指す行**の生成器
 * (束 ⑳-5a2)。
 *
 * 仕様: usecase-spec-writing.md §test_cases / ADR-0012 ⑤
 *
 * 一致の証明がユースケースごとの生成物になった以上、「そのテストが実在する」という宣言も
 * 生成物である(`data-table-eq-tests.ts` と同じ理由 —— 人が名前を書き写すと、テスト名を
 * 変えた瞬間に Y9 が落ち、直す先が 2 か所になる)。印は `test_cases` の中に置き、その中だけを
 * 生成する。**手書きの行(複合 RPC の署名と本文の突合)は印の外に残る**。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { eqSaveTestCaseIdOf } from '../../world/index.js';
import type { EqSaveTestCase, EqSaveTestSuite } from './code-eq-save-tests.js';
import { eqSaveTestSuites } from './code-eq-save-tests.js';
import { eqSaveTestPlacerOf } from './test-placement.js';

/** 生成ブロックの印の名前。 */
export const USECASE_EQ_TESTS_MARKER = 'usecase-eq-tests';

/** 全 usecase_spec の `test_cases` の生成ブロックを書き出すジェネレーター。 */
export const usecaseEqTestsGenerator: DocGenerator = {
  id: 'usecase-eq-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = eqSaveTestPlacerOf(ctx);
    if (place === null) return [];
    return eqSaveTestSuites(model, ctx).flatMap((suite) => {
      if (suite.specFile === '') return [];
      const testFile = place(suite.usecase);
      return [
        {
          file: suite.specFile,
          marker: USECASE_EQ_TESTS_MARKER,
          content: suite.sections
            .flatMap((section) => section.cases.map((entry) => renderCase(suite, entry, testFile)))
            .join('\n'),
        },
      ];
    });
  },
};

/**
 * テストケース 1 件(フロントマターの並びに収まる字下げで出す)。
 *
 * `covers` が `other` なのは、このテストが確かめるのが**結末そのもの**ではなく
 * **2 つの写しが同じ結末を出すこと**だからである(単発の操作の注釈と同じ扱い)。
 */
function renderCase(suite: EqSaveTestSuite, entry: EqSaveTestCase, testFile: string): string {
  return [
    `  - id: ${eqSaveTestCaseIdOf(suite.usecase, entry.index)}`,
    '    type: integration',
    '    covers: [other]',
    `    spec_ids: [${suite.specId}]`,
    `    implementation: "${testFile}::${entry.title}"`,
  ].join('\n');
}
