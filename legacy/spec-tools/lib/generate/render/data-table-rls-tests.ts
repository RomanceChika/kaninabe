/**
 * data_table の `test_cases` のうち、**生成した RLS の挙動テストを指す行**の生成器(束 ⑳-4b)。
 *
 * 仕様: ARCH-SP-BE-0001 §テーブル仕様 / domain-spec-writing.md §access_spec
 *
 * 挙動テストが生成物になった以上、「そのテストが実在する」という宣言も生成物である
 * (`action-test-cases.ts` と同じ理由 —— 人が名前を書き写すと、名前を変えた瞬間に A6 が落ち、
 * 直す先が 2 か所になる)。印は `test_cases` の中に置き、その中だけを生成する。**手書きの行は
 * 印の外に残る**(表ごとの突合テスト・RPC の突合テストの宣言)。
 *
 * これにより境界(`filters`)の見張りテストの宣言も生成物になる —— T4 が要求するテスト名は
 * `tenantCanaryTestName` から出ており、生成テストの `it` 名と同じ関数を使う。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { rlsTestCaseIdOf } from '../../world/index.js';
import type { RlsTestCase, RlsTestSuite } from './code-rls-behaviour-tests.js';
import { rlsTestSuites } from './code-rls-behaviour-tests.js';
import { rlsTestPlacerOf } from './test-placement.js';

/** 生成ブロックの印の名前。 */
export const DATA_TABLE_RLS_TESTS_MARKER = 'data-table-rls-tests';

/** 全 data_table の `test_cases` の生成ブロックを書き出すジェネレーター。 */
export const dataTableRlsTestsGenerator: DocGenerator = {
  id: 'data-table-rls-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = rlsTestPlacerOf(ctx);
    if (place === null) return [];
    const tables = new Map((ctx.dataTables?.tables ?? []).map((table) => [table.table, table]));
    return rlsTestSuites(model, ctx).flatMap((suite) => {
      const table = tables.get(suite.table);
      if (table === undefined) return [];
      const testFile = place(suite.table);
      return [
        {
          file: table.location.file,
          marker: DATA_TABLE_RLS_TESTS_MARKER,
          content: suite.cases.map((entry) => renderCase(suite, entry, testFile)).join('\n'),
        },
      ];
    });
  },
};

/** テストケース 1 件(フロントマターの並びに収まる字下げで出す)。 */
function renderCase(suite: RlsTestSuite, entry: RlsTestCase, testFile: string): string {
  return [
    `  - id: ${rlsTestCaseIdOf(suite.table, entry.index)}`,
    '    type: integration',
    `    covers: [${entry.covers}]`,
    `    spec_ids: [${suite.specId}]`,
    `    implementation: ${testFile}::${entry.title}`,
  ].join('\n');
}
