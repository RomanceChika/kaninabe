/**
 * data_table(テーブル仕様)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・空配列の既定)を引き受ける。
 */

import type { DataTableSpec, DataTableSpecModel } from '../../lib/model/data/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** テスト用のテストケース宣言を 1 件作る。 */
export function dataTestCase(id: string, table: string): ActionTestCase {
  return {
    id,
    type: 'integration',
    specIds: [`table-${table}`],
    covers: ['success'],
    implementation: {
      raw: `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::${table} の突合`,
      file: 'app/src/infrastructure/__tests__/schema/data-table-parity.test.ts',
      testName: `${table} の突合`,
    },
    location: loc(`docs/specs/backend/data/tables/${table}.md`, 'test_cases[0]'),
  };
}

/**
 * data_table 1 件を作る。entity 省略 + internal: true で内部テーブルになる。
 *
 * `shape: create` の関数を持つ表は、`resend` を渡さなければ**再送で既存の行を返さない**宣言
 * (`returns_existing: false`)を持つ —— 実物の仕様では書かなければ T6 / Y12 が止めるが、再送の枝を
 * 主題にしないテストが毎回同じ 1 行を書かずに済むようにする。宣言が無い形を見たいテストは
 * `resend: undefined` を明示して渡す(キーがあれば既定を付けない)。
 */
export function dataTable(
  table: string,
  opts: Partial<Omit<DataTableSpec, 'table' | 'id' | 'relPath' | 'location' | 'resend'>> & {
    readonly resend?: DataTableSpec['resend'] | undefined;
  } = {},
): DataTableSpec {
  const { resend: given, ...rest } = opts;
  const creates = (opts.functions ?? []).some((fn) => fn.shape === 'create');
  const fallback = creates && !('resend' in opts) ? { returnsExisting: false, location: loc(`docs/specs/backend/data/tables/${table}.md`, 'resend') } : undefined;
  const resend = given ?? fallback;
  return {
    ...(resend === undefined ? {} : { resend }),
    id: `table-${table}`,
    table,
    internal: false,
    indexes: [],
    sequences: [],
    exclusions: [],
    foreignKeys: [],
    triggers: [],
    defaults: {},
    functions: [],
    checks: [],
    testCases: [dataTestCase(`TC-TABLE-${table.toUpperCase()}-001`, table)],
    location: loc(`docs/specs/backend/data/tables/${table}.md`),
    relPath: `${table}.md`,
    ...rest,
  };
}

/** DataTableSpecModel を作る(available は既定 true)。 */
export function dataTableModel(
  tables: readonly DataTableSpec[],
  available = true,
): DataTableSpecModel {
  return { available, tables };
}
