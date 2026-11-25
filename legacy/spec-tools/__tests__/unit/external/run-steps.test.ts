/**
 * X 群の実行口(束 入力の状態-c2)。
 *
 *   1. **宣言を読む段を飛ばす条件は実行口の 1 か所**(`runExternalSteps`): カタログを構築できなかった・欠けているとき、登録の
 *      `readsCatalog: true` の段は呼ばれず(段ごとのクロージャに任せない)、台帳だけを見る段(`readsCatalog: false`)は呼ばれる
 *   2. 型でも守る: 宣言を読む段は読込済みのカタログを引数で受け、カタログに依らない段はカタログを受けられない
 *   3. 宣言を読めない構成の実行ログは、台帳だけを見る X4 の `@tc` 突合のスキップ(実装の木が無いとき)も言う
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { EXTERNAL_STEPS, runExternalSteps, type ExternalStep } from '../../../lib/external/checks.js';
import type { ExternalRunInput } from '../../../lib/external/run.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import type { ExternalCatalogSpec } from '../../../lib/model/external/types.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { runExternal } from '../../../lib/verify/external-group.js';
import { configCatalog } from '../../helpers/config-builder.js';
import { dataTableModel } from '../../helpers/data-builder.js';
import { externalCatalog, externalModel, integration } from '../../helpers/external-builder.js';
import { specModel } from '../../helpers/model-builder.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { scanResult } from '../../helpers/trace-builder.js';
import { blockedInput, loadedInput } from '../../helpers/verify-inputs.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

const CATALOG = (): ExternalCatalogSpec => externalCatalog([integration('discord_webhook')]);

const runInput = (testsAvailable = true): ExternalRunInput => ({
  domain: specModel([]),
  external: loadedInput(CATALOG()),
  config: loadedInput(configCatalog([])),
  dataTables: loadedInput(dataTableModel([])),
  repoRoot: '/nonexistent-repo-root',
  roots: TEST_ROOTS,
  layout: TEST_LAYOUT,
  registry: buildTcRegistry(collectTcEntries({ external: externalModel([integration('discord_webhook')]) })),
  tests: scanResult({ available: testsAvailable, testFiles: [] }),
});

describe('runExternalSteps — 宣言を読む段を飛ばす条件は実行口の 1 か所', () => {
  it('カタログが無いとき、readsCatalog の段は呼ばれず、台帳だけを見る段は呼ばれる(段ごとの条件ではなく実行口が飛ばす)', () => {
    const spies = EXTERNAL_STEPS.map((step) => ({ step, spy: vi.spyOn(step, 'run') }));

    const findings = runExternalSteps(runInput(), null);

    for (const { step, spy } of spies) expect(spy).toHaveBeenCalledTimes(step.readsCatalog ? 0 : 1);
    expect(findings.every((finding) => EXTERNAL_STEPS.filter((step) => !step.readsCatalog).some((step) => step.id === finding.verifier))).toBe(true);
    for (const { spy } of spies) spy.mockRestore();
  });

  it('カタログが読込済みなら全段を、読込済みのカタログ(readsCatalog の段)とともに登録の順で呼ぶ', () => {
    const catalog = CATALOG();
    const calls: string[] = [];
    const spies = EXTERNAL_STEPS.map((step) => vi.spyOn(step, 'run').mockImplementation((...args: unknown[]): Finding[] => {
      calls.push(`${step.id}:${args.length === 2 && args[1] === catalog ? 'catalog' : 'input'}`);
      return [];
    }));

    runExternalSteps(runInput(), catalog);

    expect(calls).toEqual(EXTERNAL_STEPS.map((step) => `${step.id}:${step.readsCatalog ? 'catalog' : 'input'}`));
    for (const spy of spies) spy.mockRestore();
  });

  it('登録は宣言を読む段 7 本(X1・X2・X3・X5・X6・X7・X8)と、台帳だけを見る段 1 本(X4)', () => {
    expect(EXTERNAL_STEPS.filter((step) => step.readsCatalog).map((step) => step.id)).toEqual(['X1', 'X2', 'X3', 'X5', 'X6', 'X7', 'X8']);
    expect(EXTERNAL_STEPS.filter((step) => !step.readsCatalog).map((step) => step.id)).toEqual(['X4']);
  });

  it('型: カタログに依らない段はカタログを受けられない(宣言を読む段は実行口がカタログを渡す)', () => {
    // @ts-expect-error readsCatalog: false の段の run はカタログを引数に取れない(実行口が渡さない)
    const bad: ExternalStep = { id: 'X9', title: '型の確認', readsCatalog: false, run: (_input: ExternalRunInput, _catalog: ExternalCatalogSpec): Finding[] => [] };

    expect(bad.readsCatalog).toBe(false);
  });
});

describe('X 群の実行ログ — 宣言を読めない構成でも、X4 の @tc 突合のスキップを言う', () => {
  const args = (testsAvailable: boolean) => ({
    model: specModel([]),
    external: blockedInput<never>('load-failed'),
    config: loadedInput(configCatalog([])),
    dataTables: loadedInput(dataTableModel([])),
    registry: buildTcRegistry([]),
    tests: scanResult({ available: testsAvailable, testFiles: [] }),
    domainRoot: path.join(FIXTURES, 'external-repo-valid'),
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
  });
  const linesOf = (testsAvailable: boolean): string[] => {
    const lines: string[] = [];
    runExternal(args(testsAvailable), (line) => lines.push(line));
    return lines;
  };

  it('実装の木が無い(走査できない)なら、台帳だけを見る検査の @tc 突合を飛ばしたことを言う(緑が広く見せない)', () => {
    const lines = linesOf(false);

    expect(lines).toContain('X 群(外部連携カタログ): 宣言を読めないため、台帳だけを見る検査を実行しました。');
    expect(lines).toContain('X 群(外部連携カタログ): 実装の木が無いため X4 の @tc 突合はスキップしました。');
  });

  it('実装の木があるなら言わない', () => {
    expect(linesOf(true).some((line) => line.includes('X4 の @tc 突合'))).toBe(false);
  });
});
