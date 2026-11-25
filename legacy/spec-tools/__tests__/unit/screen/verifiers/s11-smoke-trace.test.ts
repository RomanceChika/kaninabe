/**
 * S11(スモーク突合)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md §smoke「smoke[].implementation の {file}::{テスト名} が、
 * 走査結果(app/e2e/*.spec.mts を含む)の @tc アノテーションと一致する」。
 * `test_cases`(S8)と違い、テストケース ID 台帳は経由しない — 突合の母集合は走査結果の
 * 生アノテーションそのものである(1 本の E2E テストを複数画面の smoke: が指すため)。
 */

import { describe, expect, it } from 'vitest';
import { smokeTraceVerifier } from '../../../../lib/screen/verifiers/s11-smoke-trace.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

const E2E_FILE = 'app/e2e/smoke.spec.mts';
const TEST_NAME = 'メンバーが3階層で申し込み、世話役が締め切って料金を確定し、プログラムを組んで中止するまで通る';

/** その E2E ファイルに 1 件だけ @tc アノテーションがある走査結果。 */
function scannedTests() {
  return {
    available: true,
    testFiles: [E2E_FILE],
    annotations: [
      {
        tcId: 'TC-SCREEN-WORKSHOP_DETAIL-019',
        specIds: ['screen-workshop-detail'],
        testName: TEST_NAME,
        file: E2E_FILE,
        line: 10,
      },
    ],
    actionFiles: [],
    operationFiles: [],
  };
}

describe('S11 スモーク突合', () => {
  it('smoke を持たない画面は何も見ない', () => {
    const input = screenInput({ screens: [screenSpec({ name: 'home' })], tests: scannedTests() });

    expect(smokeTraceVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('implementation が走査結果の @tc アノテーションと一致すれば通る', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      smoke: [{ summary: '一覧が開けることを通す', file: E2E_FILE, testName: TEST_NAME }],
    });
    const input = screenInput({ screens: [screen], tests: scannedTests() });

    expect(smokeTraceVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('implementation のファイルが走査結果に無ければ失敗する', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      smoke: [{ summary: '一覧が開けることを通す', file: 'app/e2e/missing.spec.mts', testName: TEST_NAME }],
    });
    const input = screenInput({ screens: [screen], tests: scannedTests() });

    const findings = smokeTraceVerifier.verify(input, SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S11');
    expect(findings[0]?.message).toContain('ファイル');
  });

  it('implementation のテスト名が走査結果と一致しなければ失敗する', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      smoke: [{ summary: '一覧が開けることを通す', file: E2E_FILE, testName: '存在しないテスト名' }],
    });
    const input = screenInput({ screens: [screen], tests: scannedTests() });

    const findings = smokeTraceVerifier.verify(input, SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('対応するテストが見つかりません');
  });

  it('app/ を走査できていなければ何も見ない(判断材料が無い)', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      smoke: [{ summary: '一覧が開けることを通す', file: E2E_FILE, testName: TEST_NAME }],
    });
    const input = screenInput({ screens: [screen] }); // tests 省略 = available: false

    expect(smokeTraceVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });
});
