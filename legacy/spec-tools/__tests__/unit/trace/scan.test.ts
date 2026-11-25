/**
 * app/ 走査(I/O 境界)のテスト。
 *
 * 走査対象は fixtures/app-sample(app/ と同じ構造を持つ最小ツリー)。
 * app/ が無い環境で壊れないことも、ここで担保する。
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanAppTests } from '../../../lib/trace/scan.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');
const APP = path.join(FIXTURES, 'app-sample');

/** app-sample を repoRoot 固定で走査する(結果のパスを安定させるため)。 */
function scan(root = APP) {
  return scanAppTests(root, TEST_LAYOUT, { repoRoot: FIXTURES });
}

describe('scanAppTests', () => {
  it('テストファイルを集める', () => {
    expect(scan().scan.testFiles).toEqual([
      'app-sample/src/operation/__tests__/entry/submit.test.ts',
    ]);
  });

  it('@spec / @tc アノテーションをテスト名つきで集める', () => {
    const { annotations } = scan().scan;

    expect(annotations).toEqual([
      expect.objectContaining({
        tcId: 'TC-FIXTURE-SUBMIT-001',
        specIds: ['entry.submit'],
        testName: '下書きから提出できる',
        file: 'app-sample/src/operation/__tests__/entry/submit.test.ts',
      }),
      expect.objectContaining({
        tcId: 'TC-FIXTURE-SUBMIT-002',
        specIds: ['INV-ENTRY-001'],
        testName: '不変条件違反はそのまま不変条件違反として返る',
      }),
    ]);
  });

  it('片方だけの注釈(@spec だけの行)が無ければ halfTags は空(検出そのものの規約網羅は extract-annotations.test.ts が持つ)', () => {
    expect(scan().scan.halfTags).toEqual([]);
  });

  it('_actions 配下の実装ファイルを集める', () => {
    expect(scan().scan.actionFiles).toEqual(['app-sample/src/app/_actions/entry/submit.ts']);
  });

  it('operation 配下の実装ファイルを集める(テストは含めない)', () => {
    // A10 が scans[].implementation の実在を確かめる母集合。*.test.ts は実装ではない。
    expect(scan().scan.operationFiles).toEqual(['app-sample/src/operation/entry/submit.ts']);
  });

  it('app/ が無い環境では available: false を返し、Finding は積まない', () => {
    const result = scan(path.join(FIXTURES, 'no-such-app'));

    expect(result.findings).toEqual([]);
    expect(result.scan).toEqual({
      available: false,
      testFiles: [],
      annotations: [],
      halfTags: [],
      eachTags: [],
      actionFiles: [],
      operationFiles: [],
      testBlocks: [],
      assertionHelpers: [],
      // 仕組みの根を渡していないので、仕組みの走査は未実施(製品の `available` とは独立に持つ)。
      framework: {
        state: { state: 'not_requested', reason: '仕組みの根が渡されていません' },
        testFiles: [],
        annotations: [],
      },
    });
  });

  it('境界: _actions が無くても走査自体は成功する', () => {
    const result = scanAppTests(path.join(FIXTURES, 'actions-valid'), TEST_LAYOUT, { repoRoot: FIXTURES });

    expect(result.scan.available).toBe(false);
  });

  it('製品の走査は仕組みの見張りテストの置き場(実行時パッケージ・__tests__/guarantees)を読まない(仕組みの根を渡さなくても)', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'scan-tool-guarantees-'));
    try {
      cpSync(APP, path.join(repo, 'app'), { recursive: true });
      const put = (relative: string, body: string): void => {
        const target = path.join(repo, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, body);
      };
      const tagged = ['// @spec framework-guarantee-catalog @tc TC-FW-X-001', "it('見張る', () => {});", ''].join('\n');
      put('legacy/spec-tools/__tests__/guarantees/watch.test.ts', tagged);
      put('framework/runtime/src/domain/engine/__tests__/machine.test.ts', tagged);

      const result = scanAppTests(path.join(repo, 'app'), TEST_LAYOUT, { repoRoot: repo });

      // 仕組みの見張りテストは仕組みの走査の母集合で、製品の走査には入らない。
      expect(result.scan.testFiles).toHaveLength(1);
      expect(result.scan.testFiles.filter((file) => file.startsWith('framework/'))).toEqual([]);
      expect(result.scan.annotations.map((annotation) => annotation.tcId)).not.toContain('TC-FW-X-001');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('別の配置(架空の値)では、走査の根(実装のソースの根・Server Action・operation)がその配置の値になる(Next.js の綴りの木は読まない)', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'scan-foreign-layout-'));
    try {
      const put = (relative: string, body: string): void => {
        const target = path.join(repo, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, body);
      };
      const tagged = ['// @spec guarantee-catalog @tc TC-FOREIGN-001', "it('見張る', () => {});", ''].join('\n');
      put('app/server_code/handlers/ops/entry__submit.action.ts', 'export {};\n');
      put('app/server_code/rules/entry__submit.rule.ts', 'export {};\n');
      put('app/server_code/rules/entry__submit.rule.test.ts', tagged);
      // Next.js の綴りの置き場(`src/...`)は、この配置では実装のソースの根でも走査の根でもない。
      put('app/src/app/_actions/entry/ignored.ts', 'export {};\n');
      put('app/src/operation/entry/ignored.ts', 'export {};\n');
      // E2E スモークの置き場(`e2e-root`)も配置の値。Next.js の綴り(`e2e`)の木は読まない。
      put('app/journeys/smoke.spec.mts', ['// @spec guarantee-catalog @tc TC-FOREIGN-002', "test('通る', () => {});", ''].join('\n'));
      put('app/e2e/ignored.spec.mts', ['// @spec guarantee-catalog @tc TC-FOREIGN-003', "test('読まれない', () => {});", ''].join('\n'));

      const result = scanAppTests(path.join(repo, 'app'), FOREIGN_LAYOUT, { repoRoot: repo });

      expect(result.scan.available).toBe(true);
      expect(result.scan.actionFiles).toEqual(['app/server_code/handlers/ops/entry__submit.action.ts']);
      expect(result.scan.operationFiles).toEqual(['app/server_code/rules/entry__submit.rule.ts']);
      expect([...result.scan.testFiles].sort()).toEqual(['app/journeys/smoke.spec.mts', 'app/server_code/rules/entry__submit.rule.test.ts']);
      // 実装のソースの根(`source-root`)が配置に無ければ、走査そのものが成り立たない(available: false)。
      const { 'source-root': _removed, ...withoutSource } = FOREIGN_LAYOUT;
      expect(scanAppTests(path.join(repo, 'app'), withoutSource, { repoRoot: repo }).scan.available).toBe(false);
      // Server Action・operation の役割が無い配置は、その分の走査の根が決まらない(空)。
      const { 'operation-entry': _entry, 'operation-logic': _logic, ...withoutRoles } = FOREIGN_LAYOUT;
      const partial = scanAppTests(path.join(repo, 'app'), withoutRoles, { repoRoot: repo }).scan;
      expect(partial.actionFiles).toEqual([]);
      expect(partial.operationFiles).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
