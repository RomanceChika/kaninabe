/**
 * 集約の章の操作表で、`composite` の関数が執行点になっている `writes` の規則に関数名が添うことの固定(ADR-0014)。
 *
 * 宣言が無ければ表は 1 バイトも変わらない(既存の章の出力を動かさない)。
 */

import { describe, expect, it } from 'vitest';
import { operationsRows } from '../../../../../lib/generate/render/book/domain-sections.js';
import type { DataFunctionEnforces, DataTableSpec } from '../../../../../lib/model/data/types.js';
import { dataTable, dataTableModel, dataTestCase } from '../../../../helpers/data-builder.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

/** workshop の表(`reorder_workshops` が composite)。 */
function workshops(enforces: readonly DataFunctionEnforces[] | undefined): DataTableSpec {
  return dataTable('workshops', {
    entity: 'workshop',
    functions: [
      {
        name: 'reorder_workshops',
        args: [],
        params: [],
        kind: 'rpc',
        shape: 'composite',
        alsoWrites: [],
        ...(enforces === undefined ? {} : { enforces }),
      },
    ],
    testCases: [dataTestCase('TC-TABLE-WORKSHOPS-010', 'workshops')],
  });
}

/** `workshop.update` の行の内容の欄(編集の欄)。 */
function updateRow(enforces: readonly DataFunctionEnforces[] | undefined): string {
  const model = bookModel();
  const specs = [...model.aggregates.values()].find((candidate) => candidate.name === 'workshop');
  if (specs === undefined) throw new Error('workshop が無い');
  const rows = operationsRows(model, specs, {
    ...bookCtx(),
    dataTables: dataTableModel([workshops(enforces)]),
  });
  return (rows ?? []).find((row) => row[0] === '`workshop.update`')?.[1] ?? '';
}

describe('操作表の編集の行と enforces', () => {
  it('composite が名指す規則の行に、執行点の関数名が添う', () => {
    const row = updateRow([{ writes: 'workshop', by: 'organizer', testCase: 'TC-TABLE-WORKSHOPS-010' }]);

    expect(row).toContain('編集: title(執行点: `reorder_workshops`)');
  });

  it('名指しが無ければ行は変わらない(定型の update は添えない)', () => {
    expect(updateRow(undefined)).toBe('編集: title');
  });

  it('見張りテストが実在しない名指しは数えない(書き間違いは T18 が error にする)', () => {
    const row = updateRow([{ writes: 'workshop', by: 'organizer', testCase: 'TC-TABLE-WORKSHOPS-099' }]);

    expect(row).not.toContain('執行点');
  });
});
