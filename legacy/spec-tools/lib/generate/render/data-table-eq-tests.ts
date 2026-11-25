/**
 * data_table の `test_cases` のうち、**生成した一致の証明を指す行**の生成器(束 ⑳-5a)。
 *
 * 仕様: ARCH-SP-BE-0001 §テーブル仕様 / ADR-0012 ⑤
 *
 * 一致の証明が集約ごとの生成物になった以上、「そのテストが実在する」という宣言も生成物である
 * (`data-table-rls-tests.ts` と同じ理由 —— 人が名前を書き写すと、名前を変えた瞬間に T3 が
 * 落ち、直す先が 2 か所になる)。印は `test_cases` の中に置き、その中だけを生成する。
 * **手書きの行も RLS の生成ブロックも印の外に残る**。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { eqTestCaseIdOf } from '../../world/index.js';
import type { EqTestCase, EqTestSuite } from './code-equivalence-tests.js';
import { eqTestSuites } from './code-equivalence-tests.js';
import { eqTestPlacerOf } from './test-placement.js';

/** 生成ブロックの印の名前。 */
export const DATA_TABLE_EQ_TESTS_MARKER = 'data-table-eq-tests';

/** 全 data_table の `test_cases` の生成ブロックを書き出すジェネレーター。 */
export const dataTableEqTestsGenerator: DocGenerator = {
  id: 'data-table-eq-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = eqTestPlacerOf(ctx);
    if (place === null) return [];
    const tables = new Map((ctx.dataTables?.tables ?? []).map((table) => [table.entity ?? '', table]));
    return eqTestSuites(model, ctx).flatMap((suite) => {
      const table = tables.get(suite.aggregate);
      if (table === undefined) return [];
      const testFile = place(suite.aggregate);
      return [
        {
          file: table.location.file,
          marker: DATA_TABLE_EQ_TESTS_MARKER,
          content: suite.cases.map((entry) => renderCase(suite, entry, testFile)).join('\n'),
        },
      ];
    });
  },
};

/**
 * テストケース 1 件(フロントマターの並びに収まる字下げで出す)。
 *
 * `covers` が `other` なのは、このテストが確かめるのが**結末そのもの**ではなく
 * **2 つの写しが同じ結末を出すこと**だからである(手書きの差分テストの宣言と同じ扱い)。
 */
function renderCase(suite: EqTestSuite, entry: EqTestCase, testFile: string): string {
  return [
    `  - id: ${eqTestCaseIdOf(suite.aggregate, entry.index)}`,
    '    type: integration',
    '    covers: [other]',
    `    spec_ids: [${suite.specId}]`,
    `    implementation: "${testFile}::${entry.title}"`,
  ].join('\n');
}
