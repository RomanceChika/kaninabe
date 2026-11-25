/**
 * Q6(テスト突合)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「test_cases[].implementation が実在し、テスト側の @tc と
 * 一致する」。突合そのものは A6 と共通実装(lib/testcase/test-trace-match.ts)なので、
 * ここでは Q6 として動くこと・query_spec 固有の検査(integration 必須 / spec_ids の値域)を見る。
 * テストケース ID の一意性は仕様種をまたぐ性質なので、台帳を見る A9 のテストが担う。
 */

import { describe, expect, it } from 'vitest';
import { queryTestTraceVerifier } from '../../../../lib/query/verifiers/q6-test-trace.js';
import { annotation, scanResult, testCase } from '../../../helpers/trace-builder.js';
import { accessSpec, aggregate, event, machine, specModel } from '../../../helpers/model-builder.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

const TEST_FILE = 'app/src/composition/__tests__/workshop/list.test.ts';

/** テストケースを 1 つ持つ query_spec。 */
function query(
  id = 'TC-WORKSHOP-LIST-001',
  name = 'workshop_list',
  init: { type?: 'unit' | 'integration'; specIds?: readonly string[] } = {},
) {
  return querySpec({
    name,
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    testCases: [
      testCase({
        id,
        implementation: `${TEST_FILE}::メンバーは催しを読める`,
        type: init.type ?? 'integration',
        specIds: init.specIds ?? [`query-${name.split('_').join('-')}`],
        file: 'docs/specs/backend/queries/workshop/list.md',
      }),
    ],
  });
}

/** @tc が付いた 1 件のテストを持つ走査結果。 */
function matched() {
  return scanResult({
    testFiles: [TEST_FILE],
    annotations: [
      annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: TEST_FILE, testName: 'メンバーは催しを読める' }),
    ],
  });
}

describe('Q6 テスト突合', () => {
  it('実在するテストに @tc が付いていれば通る', () => {
    const input = queryInput({
      queries: [query()],
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [
          annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: TEST_FILE, testName: 'メンバーは催しを読める' }),
        ],
      }),
    });

    expect(queryTestTraceVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('テストファイルが無ければ Q6 の違反になる', () => {
    const input = queryInput({ queries: [query()], tests: scanResult({ testFiles: [] }) });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q6');
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
  });

  it('@tc が無いテストは uncovered として違反になる', () => {
    const input = queryInput({
      queries: [query()],
      tests: scanResult({ testFiles: [TEST_FILE] }),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('がテストコードにありません');
  });

  it('テスト名の食い違いを検出する', () => {
    const input = queryInput({
      queries: [query()],
      tests: scanResult({
        testFiles: [TEST_FILE],
        annotations: [
          annotation({ tcId: 'TC-WORKSHOP-LIST-001', file: TEST_FILE, testName: '別の名前' }),
        ],
      }),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('テスト名が implementation と一致しません');
  });

  it('integration のテストケースが 1 つも無ければ違反になる', () => {
    const input = queryInput({
      queries: [query('TC-WORKSHOP-LIST-001', 'workshop_list', { type: 'unit' })],
      tests: matched(),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('type: integration のテストケースがありません');
  });

  it('spec_ids が実在しない ID を指すと違反になる', () => {
    const input = queryInput({
      queries: [query('TC-WORKSHOP-LIST-001', 'workshop_list', { specIds: ['query-nowhere'] })],
      tests: matched(),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings.map((f) => f.message)).toContain(
      'TC-WORKSHOP-LIST-001 の spec_ids query-nowhere に対応する仕様がありません',
    );
  });

  it('spec_ids には access_spec の id も書ける', () => {
    const domain = specModel([
      aggregate('workshop', {
        access: { ...accessSpec('workshop', {}), id: 'workshop-access' },
      }),
    ]);
    const input = queryInput({
      domain,
      queries: [query('TC-WORKSHOP-LIST-001', 'workshop_list', { specIds: ['workshop-access'] })],
      tests: matched(),
    });

    expect(queryTestTraceVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('spec_ids にドメインイベント ID は書けない(書き込み側の語彙)', () => {
    // 読み取りは状態を動かさないので「このテストが entry.submit を守っている」は成り立たない。
    const domain = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted' })],
          }),
        ],
      }),
    ]);
    const input = queryInput({
      domain,
      queries: [query('TC-WORKSHOP-LIST-001', 'workshop_list', { specIds: ['entry.submit'] })],
      tests: matched(),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings.map((f) => f.message)).toContain(
      'TC-WORKSHOP-LIST-001 の spec_ids entry.submit に対応する仕様がありません',
    );
    expect(findings[0]?.suggestion).toContain('書き込み側');
  });

  it('app/ を走査できていなくても、宣言だけで分かる検査は行う', () => {
    const input = queryInput({
      queries: [query('TC-WORKSHOP-LIST-001', 'workshop_list', { type: 'unit' })],
      tests: scanResult({ available: false }),
    });

    const findings = queryTestTraceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('type: integration のテストケースがありません');
  });
});
