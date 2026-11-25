/**
 * 構造の突合を一時ツリーへ写すところの単体テスト(`lib/targets/supabase/samples/db-parity-tree.ts`)。
 *
 * 見るのは 2 つである。
 *   - **写す**(symlink にしない)。symlink にすると相対 import がホストの木へ出てしまう
 *   - 設定の `include` が**実行すると決めたものだけ**で、`app/` からの相対で書かれること
 */

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeParityHarness } from '../../../../../lib/targets/supabase/samples/db-parity-tree.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** 写す対象(リポジトリルート相対)。 */
const FILES = [
  'app/src/infrastructure/__tests__/rls/policy-parity.test.ts',
  'app/src/infrastructure/__tests__/schema/api-parity.test.ts',
];

let repoRoot: string;
let treeRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'parity-tree-repo-'));
  treeRoot = mkdtempSync(path.join(tmpdir(), 'parity-tree-tree-'));
  mkdirSync(path.join(treeRoot, 'app'), { recursive: true });
  for (const file of FILES) {
    mkdirSync(path.join(repoRoot, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(repoRoot, file), `// ${file}`);
  }
});

afterEach(() => {
  for (const root of [repoRoot, treeRoot]) rmSync(root, { recursive: true, force: true });
});

describe('構造の突合の一時ツリーへの配置', () => {
  it('実行するテストを写し(symlink にしない)、app からの相対で include に並べる', () => {
    const harness = writeParityHarness({ root: treeRoot, repoRoot, files: FILES, roots: TEST_ROOTS });

    expect(harness.root).toBe(path.join(treeRoot, 'app'));
    for (const file of FILES) {
      const placed = path.join(treeRoot, file);
      expect(lstatSync(placed).isSymbolicLink()).toBe(false);
      expect(readFileSync(placed, 'utf-8')).toBe(`// ${file}`);
    }
    const config = readFileSync(harness.configFile, 'utf-8');
    expect(config).toContain('"src/infrastructure/__tests__/rls/policy-parity.test.ts"');
    expect(config).toContain('"src/infrastructure/__tests__/schema/api-parity.test.ts"');
  });

  it('実行するものが無ければ include は空になる(緑の報告は呼び側が止める)', () => {
    const harness = writeParityHarness({ root: treeRoot, repoRoot, files: [], roots: TEST_ROOTS });
    expect(readFileSync(harness.configFile, 'utf-8')).toContain('include: []');
  });
});
