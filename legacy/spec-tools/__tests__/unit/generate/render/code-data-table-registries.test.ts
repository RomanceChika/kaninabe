/**
 * code-data-table-registries の**受け入れの行**(表の `parity_accepts` → 生成物 `dataTableParityAccepts`。点検 26 回目 A26-1)のユニットテスト。
 *
 * - 照らしの種類ごとに表名を添えて写し、決まった順に並べること(端は 不変条件・表・端、関数は 関数・表)
 * - 生成物の字面に `dataTableParityAccepts` が出て、受け入れが無い製品では 3 つとも空の並びであること
 * - 6 題材の fixture で、不変条件の書き込みの端の母集合(`invariantEdgeGapsOf`)と端の受け入れが**両方向に**一致し、受け入れの試験の ID が
 *   その行の表と不変条件の試験の登録簿にあること(突合 data-table-parity が実 DB の段で見る照らしの、宣言の側の写し。題材が 19 端を
 *   黙って開けたまま通し実行から外れていた形の再発止め)。受け入れを 1 行消すと食い違いとして名指されること(変異)
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { invariantTestCaseIdsOf, parityAcceptRowsOf, registryLines } from '../../../../lib/generate/render/code-data-table-registries.js';
import { loadDataTableSpecModel } from '../../../../lib/model/data/loader.js';
import { loadSpecModel } from '../../../../lib/model/loader.js';
import { invariantEdgeGapsOf } from '../../../../lib/sql/ddl-ref-check-edges.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import { specModel } from '../../../helpers/model-builder.js';
import { dataTable } from '../../../helpers/data-builder.js';

/** 6 題材の置き場。 */
const SAMPLES_ROOT = path.resolve(import.meta.dirname, '../../../fixtures/samples');

/** 題材の名前(fixture のディレクトリ)。 */
const SAMPLES = ['archive', 'dual_actors', 'expenses', 'library', 'rooms', 'stores'] as const;

/** 端の鍵。 */
function edgeKey(row: { readonly invariant: string; readonly table: string; readonly edge: string }): string {
  return `${row.invariant} / ${row.table} / ${row.edge}`;
}

/** 題材 1 つの端の母集合と端の受け入れの食い違い(突合の照らしと同じ 3 方向)。 */
function edgeProblems(tables: readonly DataTableSpec[], domain: Parameters<typeof invariantEdgeGapsOf>[0]): string[] {
  const gaps = new Set(invariantEdgeGapsOf(domain, tables).map(edgeKey));
  const rows = parityAcceptRowsOf(tables, domain).invariantEdges;
  const registry = invariantTestCaseIdsOf(tables, domain);
  const accepted = new Set(rows.map(edgeKey));
  return [
    ...[...gaps].filter((key) => !accepted.has(key)).map((key) => `[覆われていない端] ${key}`),
    ...rows.filter((row) => !gaps.has(edgeKey(row))).map((row) => `[要らなくなった受け入れ] ${edgeKey(row)}`),
    ...rows.filter((row) => !(registry[row.table]?.[row.invariant] ?? []).includes(row.test)).map((row) => `[試験の無い受け入れ] ${edgeKey(row)} ${row.test}`),
  ].sort();
}

/** 題材の宣言を読む。 */
function loadSample(name: string): { readonly tables: readonly DataTableSpec[]; readonly domain: Parameters<typeof invariantEdgeGapsOf>[0] } {
  const root = path.join(SAMPLES_ROOT, name);
  const domain = loadSpecModel(path.join(root, 'docs/specs/domain'), { repoRoot: root }).model;
  const tables = loadDataTableSpecModel(path.join(root, 'docs/specs/backend/data'), { repoRoot: root }).model.tables;
  if (domain === null) throw new Error(`${name} のドメイン仕様が読めません`);
  return { tables, domain };
}

describe('code-data-table-registries — 受け入れの行', () => {
  it('照らしの種類ごとに表名を添えて写し、決まった順に並べる', () => {
    const rows = parityAcceptRowsOf([
      dataTable('zeta', {
        parityAccepts: [
          { check: 'trigger_advisory', function: 'f_b', invariant: 'INV-Z-001', reason: 'r1', test: 'TC-Z-001' },
          { check: 'invariant_edge', invariant: 'INV-Z-002', edge: 'update of a', reason: 'r2', test: 'TC-Z-002' },
        ],
      }),
      dataTable('alpha', {
        parityAccepts: [
          { check: 'trigger_advisory', function: 'f_a', invariant: 'INV-A-001', reason: 'r3', test: 'TC-A-001' },
          { check: 'invariant_edge', invariant: 'INV-A-001', edge: 'insert', reason: 'r4', test: 'TC-A-002' },
          { check: 'isolation_gate', function: 'g_a', invariant: 'INV-A-001', reason: 'r5', test: 'TC-A-003' },
        ],
      }),
    ], specModel([]));
    expect(rows).toEqual({
      invariantEdges: [
        { invariant: 'INV-A-001', table: 'alpha', edge: 'insert', reason: 'r4', test: 'TC-A-002' },
        { invariant: 'INV-Z-002', table: 'zeta', edge: 'update of a', reason: 'r2', test: 'TC-Z-002' },
      ],
      triggerAdvisory: [
        { function: 'f_a', reason: 'r3', table: 'alpha', invariant: 'INV-A-001', test: 'TC-A-001' },
        { function: 'f_b', reason: 'r1', table: 'zeta', invariant: 'INV-Z-001', test: 'TC-Z-001' },
      ],
      isolationGate: [{ function: 'g_a', reason: 'r5', table: 'alpha', invariant: 'INV-A-001', test: 'TC-A-003' }],
    });
  });

  it('生成物に dataTableParityAccepts が出る(受け入れが無ければ 3 つとも空)', () => {
    const empty = registryLines([dataTable('items')], specModel([])).join('\n');
    expect(empty).toContain('export const dataTableParityAccepts');
    expect(empty).toMatch(/invariantEdges: \[\],\s*triggerAdvisory: \[\],\s*isolationGate: \[\],/u);
    const one = registryLines(
      [dataTable('items', { parityAccepts: [{ check: 'isolation_gate', function: 'check_x', invariant: 'INV-X-001', reason: '読まない', test: 'TC-X-001' }] })],
      specModel([]),
    ).join('\n');
    expect(one).toContain("function: 'check_x'");
    expect(one).toContain("table: 'items'");
  });

  it.each(SAMPLES)('題材 %s: 端の母集合と端の受け入れが両方向に一致し、試験の ID が登録簿にある', (name) => {
    const { tables, domain } = loadSample(name);
    expect(edgeProblems(tables, domain)).toEqual([]);
  });

  it('stores: 端の受け入れを 1 行消すと「覆われていない端」、凍結(freezes)を外すと凍らせていた列の update of の端が開く(変異。点検 fix26 2 回目)', () => {
    const { tables, domain } = loadSample('stores');
    expect(parityAcceptRowsOf(tables, domain).invariantEdges.length).toBeGreaterThan(0);
    const dropped = tables.map((table) => (table.table === 'stock_receipts' ? { ...table, parityAccepts: (table.parityAccepts ?? []).slice(1) } : table));
    expect(edgeProblems(dropped, domain).some((problem) => problem.startsWith('[覆われていない端]'))).toBe(true);
    const thawed = tables.map((table) => ({ ...table, triggers: table.triggers.filter((trigger) => trigger.freezes === undefined) }));
    expect(edgeProblems(thawed, domain)).toContain('[覆われていない端] INV-SECTION-002 / stores / update of company_id');
    expect(edgeProblems(thawed, domain)).toContain('[覆われていない端] INV-STOCK-MOVE-003 / stock_receipts / update of shelf_id');
  });

  // 点検 26 回目の後の判断待ち 1: 生成した天井のトリガは鍵を取るので、受け入れの行を手で書かずに宣言(creates[].abuse と天井を名指す不変条件)から導く。
  it('rooms: 天井の鍵の受け入れは宣言から導く(関数・表・不変条件・試験は宣言で決まり、手で書いた行は無い)。天井の不変条件の試験が無ければ導かない', () => {
    const { tables, domain } = loadSample('rooms');
    expect(tables.flatMap((table) => table.parityAccepts ?? []).filter((accept) => accept.check === 'trigger_advisory')).toEqual([]);
    expect(parityAcceptRowsOf(tables, domain).triggerAdvisory).toEqual([
      { function: 'check_feedback_rate_limit', reason: expect.stringContaining('feedbacks:ceiling') as string, table: 'feedbacks', invariant: 'INV-FEEDBACK-001', test: 'TC-TABLE-FEEDBACKS-003' },
    ]);
    const untested = tables.map((table) => (table.table === 'feedbacks' ? { ...table, testCases: table.testCases.filter((testCase) => !testCase.specIds.includes('INV-FEEDBACK-001')) } : table));
    expect(parityAcceptRowsOf(untested, domain).triggerAdvisory).toEqual([]);
  });
});
