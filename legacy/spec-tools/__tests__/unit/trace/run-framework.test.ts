/**
 * トレース検証の実行口(`runTraceVerification`)が仕組みの根の走査を運ぶことのテスト。
 *
 * 仕組みの走査は action_spec に依らない(製品が `actions` を採っていなくても、実装の木が無くても行う)。
 * 根を渡さなければ `not_requested`(Z3 が未実施と名指す)で、**製品の `appAvailable` は仕組みの存在に影響されない**。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTraceVerification } from '../../../lib/trace/run.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { catalogInput } from '../../../lib/kernel/input-state.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import type { ExternalCatalogSpec } from '../../../lib/model/external/types.js';
import type { JobCatalogSpec } from '../../../lib/model/job/types.js';
import { specModel } from '../../helpers/model-builder-v8plus.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const FW_TEST = 'framework/runtime/src/domain/__tests__/engine.test.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 仕組みの根(見張りテスト 1 本を持つ)を作る。 */
function frameworkTree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'trace-framework-'));
  made.push(dir);
  const target = path.join(dir, FW_TEST);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, ["// @spec framework-guarantee-catalog @tc TC-FW-ENGINE-001", "it('遷移', () => { expect(1).toBe(1); });", ''].join('\n'));
  return dir;
}

/** 製品が何も採らず(`uses: []` 相当)・実装の木も宣言していない実行。 */
function run(frameworkRoot: string | undefined, repoRoot: string) {
  return runTraceVerification(specModel({}), {
    actions: catalogInput<ActionSpecModel>('unselected'),
    appRoot: null,
    repoRoot,
    ...(frameworkRoot === undefined ? {} : { frameworkRoot }),
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
    registry: buildTcRegistry([]),
    jobs: catalogInput<JobCatalogSpec>('unselected'),
    dataTables: catalogInput<DataTableSpecModel>('unselected'),
    external: catalogInput<ExternalCatalogSpec>('unselected'),
  });
}

describe('runTraceVerification と仕組みの根の走査', () => {
  it('action_spec を採らず実装の木も無い製品でも、仕組みの走査は行われ、製品の appAvailable は false のまま', () => {
    const root = frameworkTree();

    const result = run(root, root);

    expect(result.actionsAvailable).toBe(false);
    expect(result.appAvailable).toBe(false);
    expect(result.tests.framework?.state.state).toBe('scanned');
    expect(result.tests.framework?.annotations.map((annotation) => annotation.tcId)).toEqual(['TC-FW-ENGINE-001']);
    expect(result.tests.annotations).toEqual([]);
  });

  it('根を渡さなければ not_requested(Z3 が未実施と名指す)', () => {
    const root = frameworkTree();

    expect(run(undefined, root).tests.framework?.state.state).toBe('not_requested');
  });
});
