/**
 * `check:formal --freshness` は**鮮度だけ**を見て、TLC の道具(Java / jar)を探しにいかない。
 *
 * 道具を探すかどうかを「道具が無い環境」で聞く: HOME を空のディレクトリにして jar の既定の置き場を消し、
 * `TLA_TOOLS_JAR` / `JAVA_HOME` も外す。道具を探す全実行は「道具が無い」で終了コード 1 になり、
 * `--freshness` は同じ環境で終了コード 0 になる。
 *
 * **模型の前提の比(予算 + タイムアウト < リース)も `--freshness` が見る**(束 CI-cost)。TLC の `formal` ジョブは
 * モデルそのものが動いたときだけ起きるので、実装の値だけを動かしたコミットの比は毎 push の経路(ここ)が持つ。
 *
 * `--freshness` の緑・赤は**一時ディレクトリに組んだ小さな製品**(`.tla` 1 本と写し元 2 本)で見る —— 実リポジトリの
 * 鮮度に依らせると、写し元の閉包のどこかを触っただけでこのテストが落ち、「道具を探さない」という本題と
 * 無関係な理由で赤になる(実リポジトリの鮮度は CI の docs ジョブと pre-commit が直に見る)。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { computeClosure } from '../../../lib/semantics/import-closure.js';
import { FRAMEWORK_CLI_DIR, FRAMEWORK_SPEC_TOOLS_DIR } from '../../../lib/io/paths.js';
import { withoutGitEnv } from '../../helpers/git-env.js';
import { httpEntryPath } from '../../../lib/model/product/layout.js';
import { generatedPath, migrationPath } from '../../../lib/model/product/paths.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import { worktreeReader } from '../../../cli/formal-sources-io.js';

/** リポジトリルート(このファイルは legacy/spec-tools/__tests__/unit/formal/ にある)。 */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const CLI = path.join(REPO_ROOT, FRAMEWORK_CLI_DIR, 'check-formal.ts');
const TSX = path.join(REPO_ROOT, FRAMEWORK_SPEC_TOOLS_DIR, 'node_modules', '.bin', 'tsx');

const emptyHome = mkdtempSync(path.join(tmpdir(), 'formal-nohome-'));
const products: string[] = [];
afterAll(() => {
  for (const dir of [emptyHome, ...products]) rmSync(dir, { recursive: true, force: true });
});

/** 一時ディレクトリに小さな製品(宣言・写し元 2 本・それを写した `.tla`)を組む。`.tla` は写し元の閉包の hash を宣言する。 */
function smallProduct(leaf = 'export const leaf = 1;\n'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'formal-product-'));
  products.push(root);
  writeProductDeclaration(root);
  mkdirSync(path.join(root, 'lib'));
  mkdirSync(path.join(root, 'formal'));
  writeFileSync(path.join(root, 'lib/entry.ts'), "import { leaf } from './leaf.js';\nexport const entry = leaf;\n");
  writeFileSync(path.join(root, 'lib/leaf.ts'), 'export const leaf = 1;\n');
  const declared = computeClosure('lib/entry.ts', worktreeReader(root))?.hash ?? '';
  writeFileSync(path.join(root, 'formal/M.tla'), `---- MODULE M ----\n\\* SOURCE: lib/entry.ts ${declared}\n`);
  // 葉だけを後から動かす(宣言は古いまま)= import 先だけが変わった束。
  writeFileSync(path.join(root, 'lib/leaf.ts'), leaf);
  return root;
}

/** 一時ディレクトリの製品に、前提の読み取り元 3 つ(予算・タイムアウト・リースの既定)を、製品の宣言した置き場へ書く。 */
function writePremise(root: string, values: { budgetMs: number; timeoutMs: number; leaseSeconds: number }): void {
  const write = (relative: string | null, text: string): void => {
    if (relative === null) throw new Error('実装の木を宣言していない根です');
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  };
  write(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, '/api/jobs/run'), `const BUDGET_MS = ${String(values.budgetMs)};\n`);
  write(generatedPath(TEST_ROOTS, 'external-expectations.ts'), `export const x = { timeoutMs: ${String(values.timeoutMs)}, };\n`);
  write(
    migrationPath(TEST_ROOTS, '20260101000000_claim_due_jobs.sql'),
    `create or replace function claim_due_jobs(p_lease_seconds integer default ${String(values.leaseSeconds)}) returns void as $$ begin end $$ language plpgsql;\n`,
  );
}

/** 道具の無い環境で CLI を回す(親の npm の変数・git がリポジトリを決める変数は継がない)。 */
function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...withoutGitEnv(), HOME: emptyHome };
  for (const key of Object.keys(env)) {
    if (key === 'INIT_CWD' || key === 'TLA_TOOLS_JAR' || key === 'JAVA_HOME' || key.startsWith('npm_') || key.startsWith('NPM_')) {
      delete env[key];
    }
  }
  const result = spawnSync(TSX, [CLI, ...args], { cwd: REPO_ROOT, env, encoding: 'utf-8', timeout: 120_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check:formal --freshness', () => {
  it('道具が無い環境でも鮮度だけは見て、緑で終わる(TLC の道具を探しにいかない)', { timeout: 300_000 }, () => {
    const result = run(['--freshness', '--root', smallProduct()]);

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('鮮度と前提の比のみ');
    expect(result.stdout).toContain('TLC は回していません');
    expect(result.stdout).toContain('entry.ts 2');
  });

  it('同じ道具の無い環境で、閉包の葉だけが動いていれば赤(その import 先のパスを名指す)', { timeout: 300_000 }, () => {
    const result = run(['--freshness', '--root', smallProduct('export const leaf = 2;\n')]);

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('lib/entry.ts');
    expect(result.stdout).toContain('1 件の鮮度・前提のエラー');
  });

  it('同じ環境で --freshness 無しなら道具が無いと報告して落ちる(全実行は道具を要る)', { timeout: 300_000 }, () => {
    const result = run([]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tla2tools.jar');
  });

  it('知らない引数は黙って全実行(TLC)に化けず、止まる', { timeout: 300_000 }, () => {
    const result = run(['--fresness']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('知らない引数');
  });

  it('模型の前提の比が成り立っていれば緑で、確かめた値を出す(予算 + タイムアウト < リース)', { timeout: 300_000 }, () => {
    const root = smallProduct();
    writePremise(root, { budgetMs: 50_000, timeoutMs: 5_000, leaseSeconds: 300 });
    const result = run(['--freshness', '--root', root]);

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('Outbox の前提: 予算 50000ms + タイムアウト 5000ms < リース 300000ms');
  });

  it('実装の値だけが動いて比が崩れたら、鮮度が緑でも赤(TLC を回さない経路が前提の比を持つ)', { timeout: 300_000 }, () => {
    const root = smallProduct();
    writePremise(root, { budgetMs: 290_000, timeoutMs: 20_000, leaseSeconds: 300 });
    const result = run(['--freshness', '--root', root]);

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('Outbox の前提が崩れました');
    expect(result.stdout).toContain('1 件の鮮度・前提のエラー');
  });
});
