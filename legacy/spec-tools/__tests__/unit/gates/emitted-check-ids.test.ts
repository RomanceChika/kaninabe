/**
 * 実際に出た違反の検査 ID が、すべて全検査の表(`lib/compose/all-checks.ts`)に載っていること(出した検査 ⊆ 登録した検査)。
 *
 * 表の登録漏れを見る 2 つ目の網。1 つ目の網(`check-registry.test.ts`)は検査器のコードに書かれた ID の綴りを表と突き合わせる —— 綴りを
 * 定数から組み立てる検査器・登録の無い群の新しい接頭辞は、そこをすり抜ける。ここでは**実行して**出てきた違反の `verifier` を表と突き合わせる。
 *
 * 見る題材は、このリポジトリの製品・6 つのサンプルの題材・壊れた仕様の束(既知解テストの木と同じ組み方)。
 * **限界**: 題材が踏まない検査(違反を 1 件も出さない検査)は、この網では見えない。そこは 1 つ目の網と、群の実行口の対応
 * (`pipeline-group-registry.test.ts`)が受け持つ。
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { knownCheckIds } from '../../../lib/compose/all-checks.js';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** 実行が重い(Z3 を含む全群)ので、題材ごとに余裕を持たせる。 */
const TIMEOUT_MS = 300_000;

/** 後始末する一時ツリー。 */
const temporaryTrees: string[] = [];

afterAll(() => {
  for (const tree of temporaryTrees) rmSync(tree, { recursive: true, force: true });
});

/** 全群を回し、出た違反の検査 ID を集める。 */
async function emittedIds(domainRoot: string): Promise<ReadonlySet<string>> {
  const { findings } = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot });
  return new Set(findings.map((finding) => finding.verifier));
}

/** 表に無い ID(あれば、その題材が出した違反が登録されていない)。 */
function unregistered(ids: ReadonlySet<string>): string[] {
  const known = knownCheckIds();
  return [...ids].filter((id) => !known.has(id)).sort();
}

/** 壊れた仕様の束を、既知解テストと同じ組み方で 1 本の製品にする。 */
function brokenTree(): string {
  const repo = mkdtempSync(join(tmpdir(), 'emitted-check-ids-'));
  temporaryTrees.push(repo);
  writeProductDeclaration(repo, ['actions', 'queries', 'screens']);
  const root = join(repo, TEST_ROOTS.specs);
  mkdirSync(join(root, 'backend'), { recursive: true });
  cpSync(join(FIXTURES, 'domain-invalid'), join(root, 'domain'), { recursive: true });
  cpSync(join(FIXTURES, 'actions-invalid'), join(root, 'backend', 'actions'), { recursive: true });
  cpSync(join(FIXTURES, 'queries-invalid'), join(root, 'backend', 'queries'), { recursive: true });
  cpSync(join(FIXTURES, 'screens-invalid', 'screens'), join(root, 'frontend', 'screens'), { recursive: true });
  cpSync(join(FIXTURES, 'screens-invalid', 'chrome'), join(root, 'frontend', 'chrome'), { recursive: true });
  return root;
}

describe('出た違反の検査 ID は、すべて全検査の表に載っている', () => {
  it('このリポジトリの製品(警告も含めて全群が回る)', async () => {
    const ids = await emittedIds(join(REPO_ROOT, 'docs', 'specs', 'domain'));

    expect(ids.size).toBeGreaterThan(0);
    expect(unregistered(ids)).toEqual([]);
  }, TIMEOUT_MS);

  const samples = readdirSync(join(FIXTURES, 'samples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('サンプルの題材が見つかっている', () => {
    expect(samples.length).toBeGreaterThanOrEqual(6);
  });

  it.each(samples)('サンプルの題材 %s', async (name) => {
    const tree = mkdtempSync(join(tmpdir(), `emitted-check-ids-${name}-`));
    temporaryTrees.push(tree);
    cpSync(join(FIXTURES, 'samples', name), tree, { recursive: true });

    const ids = await emittedIds(join(tree, 'docs', 'specs', 'domain'));

    expect(unregistered(ids)).toEqual([]);
  }, TIMEOUT_MS);

  it('壊れた仕様の束(読み込みの診断・意味の違反が多く出る)', async () => {
    const ids = await emittedIds(join(brokenTree(), 'domain'));

    expect(ids.size).toBeGreaterThan(10);
    expect(unregistered(ids)).toEqual([]);
  }, TIMEOUT_MS);

  it('表にない ID を出す検査があれば、ここで名指しされる(判定の反例)', () => {
    expect(unregistered(new Set(['T8', 'ZZ99']))).toEqual(['ZZ99']);
  });
});
