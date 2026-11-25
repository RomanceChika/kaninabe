/**
 * 台帳検査の実行口(lib/spec-index/run.ts)のテスト。
 *
 * この群の要点は**仕様種ごとの実行条件の外で走ること**である。以前 A9 は A 群の中にあり、
 * `specs/backend/actions` を読めない構成では実行されなかったため、
 * 「action_spec が 1 件も無いリポジトリの query_spec どうしの ID 重複」が無検査だった。
 * ここではその構成(actions = null)で違反が落ちることを固定する。
 */

import { describe, expect, it } from 'vitest';
import { runSpecIndexVerification } from '../../../lib/spec-index/run.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { actionSpec, testCase } from '../../helpers/trace-builder.js';
import { querySpec } from '../../helpers/query-builder.js';

const IMPL = 'app/src/composition/__tests__/workshop/list.test.ts::メンバーは催しを読める';

/** 指定した ID のテストケースを 1 件だけ持つ query_spec。 */
function query(name: string, id: string) {
  return querySpec({
    name,
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    testCases: [testCase({ id, implementation: IMPL, type: 'integration' })],
  });
}

describe('runSpecIndexVerification', () => {
  it('action_spec を読めない構成でも query_spec どうしの ID 重複を検出する', () => {
    const registry = buildTcRegistry(
      collectTcEntries({
        actions: null,
        queries: {
          available: true,
          queries: [
            query('workshop_list', 'TC-WORKSHOP-LIST-001'),
            query('workshop_archive', 'TC-WORKSHOP-LIST-001'),
          ],
        },
      }),
    );

    const findings = runSpecIndexVerification(registry);

    expect(findings.map((finding) => finding.verifier)).toEqual(['A9']);
    expect(findings[0]?.message).toContain('TC-WORKSHOP-LIST-001');
  });

  it('ID が一意なら何も出ない', () => {
    const registry = buildTcRegistry(
      collectTcEntries({
        actions: {
          actions: [
            actionSpec({
              handles: 'entry.submit',
              testCases: [
                testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: IMPL, covers: ['success'] }),
              ],
            }),
          ],
          unhandled: [],
          scans: [],
          unscanned: [],
          testTagBaseline: [],
        },
        queries: { available: true, queries: [query('workshop_list', 'TC-WORKSHOP-LIST-001')] },
      }),
    );

    expect(runSpecIndexVerification(registry)).toEqual([]);
  });

  it('境界: 台帳が空でも壊れない', () => {
    expect(runSpecIndexVerification(buildTcRegistry([]))).toEqual([]);
  });
});
