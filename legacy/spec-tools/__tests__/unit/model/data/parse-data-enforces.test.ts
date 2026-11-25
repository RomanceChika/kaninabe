/**
 * `functions[].enforces`(`composite` の関数が執行点になる規則の宣言)のパーサー(T0 = 形)のテスト。
 *
 * ここが見るのは**形**だけである: 要素の欠落・余計なキー(`when` / `fields` は access_spec が正なので書けない)・
 * 空のリスト。書ける場所(`composite` だけ)・規則と見張りテストの実在は T18 が見る(`t18-composite-enforces.test.ts`)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';

/** 一括の並べ替えを持つ表(架空の題材)。`enforces` は引数で差し替える。 */
function data(enforces: unknown, shape = 'composite'): Record<string, unknown> {
  return {
    doc_type: 'data_table',
    scope: 'backend',
    id: 'table-slots',
    table: 'slots',
    entity: 'slot',
    functions: [
      {
        name: 'reorder_slots',
        args: ['uuid[]'],
        kind: 'rpc',
        shape,
        ...(shape === 'composite' ? { returns: 'rows', also_writes: {}, self_writes: ['update'] } : {}),
        ...(enforces === undefined ? {} : { enforces }),
      },
    ],
    test_cases: [
      {
        id: 'TC-TABLE-SLOTS-001',
        type: 'integration',
        covers: ['success'],
        spec_ids: ['table-slots'],
        implementation: 'app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::slots の突合',
      },
    ],
  };
}

/** パースして違反の文面だけ返す。 */
function errors(enforces: unknown): readonly string[] {
  const reporter = new SpecReporter('docs/specs/backend/data/tables/slots.md');
  const { findings } = parseDataTableSpec(data(enforces), 'slots.md', reporter);
  return findings.filter((found) => found.severity === 'error').map((found) => found.message);
}

describe('functions[].enforces の形(T0)', () => {
  it('writes / by / test_case を読める(書かなければ宣言なし)', () => {
    const reporter = new SpecReporter('docs/specs/backend/data/tables/slots.md');
    const declared = parseDataTableSpec(
      data([
        { writes: 'slot', by: 'organizer', test_case: 'TC-TABLE-SLOTS-001' },
        { writes: 'slot', by: 'staff', test_case: 'TC-TABLE-SLOTS-001' },
      ]),
      'slots.md',
      reporter,
    );
    const absent = parseDataTableSpec(data(undefined), 'slots.md', new SpecReporter('x.md'));

    expect(declared.findings.filter((found) => found.severity === 'error')).toEqual([]);
    expect(declared.value?.functions[0]?.enforces).toEqual([
      { writes: 'slot', by: 'organizer', testCase: 'TC-TABLE-SLOTS-001' },
      { writes: 'slot', by: 'staff', testCase: 'TC-TABLE-SLOTS-001' },
    ]);
    expect(absent.value?.functions[0]?.enforces).toBeUndefined();
  });

  it('書き場所(shape)はパーサーが決めず、T18 に渡す(定型の関数に書いても読める)', () => {
    const { value } = parseDataTableSpec(
      data([{ writes: 'slot', by: 'organizer', test_case: 'TC-TABLE-SLOTS-001' }], 'update'),
      'slots.md',
      new SpecReporter('x.md'),
    );

    expect(value?.functions[0]?.enforces).toHaveLength(1);
  });

  it('writes / by / test_case のどれが欠けてもエラーで、その要素は載らない', () => {
    for (const missing of ['writes', 'by', 'test_case']) {
      const item: Record<string, string> = { writes: 'slot', by: 'organizer', test_case: 'TC-TABLE-SLOTS-001' };
      delete item[missing];
      const reporter = new SpecReporter('x.md');
      const { value, findings } = parseDataTableSpec(data([item]), 'slots.md', reporter);

      expect(findings.some((found) => found.message.includes(`${missing} がありません`)), missing).toBe(true);
      expect(value?.functions[0]?.enforces, missing).toBeUndefined();
    }
  });

  it('when / fields を書くとエラー(正は access_spec の規則で、写すと 2 重の正になる)', () => {
    const messages = errors([{ writes: 'slot', by: 'organizer', test_case: 'TC-TABLE-SLOTS-001', when: 'x == 1' }]);

    expect(messages.some((message) => message.includes('when は書けません'))).toBe(true);
  });

  it('リストでない・要素がマッピングでない・空のリストはエラー', () => {
    expect(errors('slot').some((message) => message.includes('リストで書きます'))).toBe(true);
    expect(errors(['slot']).some((message) => message.includes('マッピングで書きます'))).toBe(true);
    expect(errors([]).some((message) => message.includes('enforces が空です'))).toBe(true);
  });
});
