/**
 * S8(テスト突合)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「test_cases[].implementation が実在し、テスト側の `@tc` と
 * 一致し、spec_ids が実在する」。3 段の突合そのものは A6 / Q6 と共通実装
 * (lib/testcase/test-trace-match.ts)なので、ここでは S8 として動くこと・画面固有の検査
 * (spec_ids の値域)・走査できないときに黙ることを見る。
 * テストケース ID の一意性は仕様種をまたぐ性質なので、台帳を見る A9 のテストが担う。
 */

import { describe, expect, it } from 'vitest';
import { testTraceVerifier } from '../../../../lib/screen/verifiers/s8-test-trace.js';
import { annotation, scanResult, testCase } from '../../../helpers/trace-builder.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { SCREEN_CTX, chromeSpec, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

const TEST_FILE = 'app/src/app/__screens__/workshop-list.test.tsx';
const SPEC_FILE = 'docs/specs/frontend/screens/workshop/workshop_list.md';
const TEST_NAME = '宣言したスロット部品がすべて描画される';

/** テストケースを 1 つ持つ screen_spec。 */
function screen(specIds: readonly string[] = ['screen-workshop-list']) {
  return screenSpec({
    name: 'workshop_list',
    group: 'workshop',
    testCases: [
      testCase({
        id: 'TC-SCREEN-WORKSHOP_LIST-001',
        implementation: `${TEST_FILE}::${TEST_NAME}`,
        specIds,
        file: SPEC_FILE,
      }),
    ],
  });
}

/** `@tc` が付いた 1 件のテストを持つ走査結果。 */
function matched() {
  return scanResult({
    testFiles: [TEST_FILE],
    annotations: [
      annotation({ tcId: 'TC-SCREEN-WORKSHOP_LIST-001', file: TEST_FILE, testName: TEST_NAME }),
    ],
  });
}

describe('S8 テスト突合', () => {
  it('実在するテストに @tc が付いていれば通る', () => {
    const findings = testTraceVerifier.verify(
      screenInput({ screens: [screen()], tests: matched() }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('implementation の指すテストファイルが無ければ失敗する', () => {
    const findings = testTraceVerifier.verify(
      screenInput({ screens: [screen()], tests: scanResult({ testFiles: [] }) }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S8');
    expect(findings[0]?.message).toContain('テストファイルがありません');
  });

  it('テスト側に @tc が無ければ失敗する', () => {
    const findings = testTraceVerifier.verify(
      screenInput({ screens: [screen()], tests: scanResult({ testFiles: [TEST_FILE] }) }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('@tc TC-SCREEN-WORKSHOP_LIST-001');
  });

  it('テスト名が implementation と食い違えば失敗する', () => {
    const tests = scanResult({
      testFiles: [TEST_FILE],
      annotations: [
        annotation({ tcId: 'TC-SCREEN-WORKSHOP_LIST-001', file: TEST_FILE, testName: '別の名前' }),
      ],
    });

    const findings = testTraceVerifier.verify(screenInput({ screens: [screen()], tests }), SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('テスト名が implementation と一致しません');
  });

  it('spec_ids に画面 id・chrome id・query id・ドメインイベント ID を書ける', () => {
    const domain = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
      }),
    ]);
    const input = screenInput({
      domain,
      queries: [querySpec({ name: 'workshop_list', source: 'entry', for: ['member'], scopeUsed: 'all' })],
      chromes: [chromeSpec({ name: 'member' })],
      screens: [
        screen(['screen-workshop-list', 'chrome-member', 'query-workshop-list', 'entry.submit']),
      ],
      tests: matched(),
    });

    expect(testTraceVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('spec_ids が実在しなければ失敗する', () => {
    const findings = testTraceVerifier.verify(
      screenInput({ screens: [screen(['screen-nowhere'])], tests: matched() }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('spec_ids screen-nowhere');
  });

  it('app/ を走査できていなければ @tc の突合はしない', () => {
    const findings = testTraceVerifier.verify(
      screenInput({ screens: [screen()], tests: scanResult({ available: false }) }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });
});

describe('S8: 読み取りクエリ(query_spec)が阻害のとき(spec_ids の値域に query の id が入る)', () => {
  const unknownId = () => screenInput({ screens: [screen(['query-dropped'])], tests: matched() });

  it('読めていれば、値域に無い spec_ids を言う(保留が効いている対)', () => {
    expect(testTraceVerifier.verify(unknownId(), SCREEN_CTX).map((finding) => finding.message)).toEqual([
      expect.stringContaining('spec_ids query-dropped に対応する仕様がありません'),
    ]);
  });

  it('阻害なら spec_ids の値域の突合は言わない(@tc の突合は実行済み)', () => {
    const blocked = { ...SCREEN_CTX, blockedInputs: ['queries'] } as const;

    expect(testTraceVerifier.verify(unknownId(), blocked)).toEqual([]);
    const noTest = screenInput({ screens: [screen(['query-dropped'])], tests: scanResult({ testFiles: [] }) });
    expect(testTraceVerifier.verify(noTest, blocked).length).toBeGreaterThan(0);
  });
});
