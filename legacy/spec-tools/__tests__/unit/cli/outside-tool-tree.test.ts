/**
 * **道具の木(`legacy/spec-tools`)の外にある製品の木から CLI を呼ぶ**テスト。
 *
 * 題材を一時ディレクトリに写し、**作業ディレクトリをそこにして**道具(この木の `cli/`)を子プロセスで
 * 実行する。見るのは **CLI の入口が作業ディレクトリから根を決める**ことだけである:
 *   - `verify` / `generate` が成功し、生成物が**一時ディレクトリの根の宣言の位置**に出る
 *   - **道具の木には 1 ファイルも書かれない**(実行の前後で道具の木のファイルの一覧・大きさ・更新時刻が同じ)
 *   - `--root` で指せば(`--root <path>` と `--root=<path>` の両方)、作業ディレクトリが製品の木の外でも動く
 *   - `INIT_CWD`(npm が起動された場所)があれば、根の探索と相対パスの基準はそちらになる
 *     (ルートの取り次ぎは作業ディレクトリが道具の木になるので、ルートで打った相対パスを正しく解くため)
 *   - `product.md` の無い場所から呼べば、終了コードが 0 でなく、根が見つからない旨の文言が出る
 *
 * 生成物の中身の正しさは通し実行(`__tests__/samples/`)の仕事で、ここは重ねない。通し実行が
 * lib を直接呼ぶのに対し、これは**本物の CLI を別プロセスで**動かす(入口の配線そのものを見る)。
 *
 * 題材は `library`(不変条件の無い集約を持つ題材)。`generate` は本物の CLI なので、標識の置き場の検査
 * (`blockProblems`)まで通る題材でなければ終了コードが 1 になる。不変条件の無い集約の標識が章に出ない穴は
 * `stores`(全集約が不変条件を持つ)では見えなかったので、見える題材を使う。
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FRAMEWORK_CLI_DIR, PRODUCT_DECL_FILE, toRelative, walkFiles } from '../../../lib/io/paths.js';
import { ROOT_MESSAGES } from '../../../lib/io/messages.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { declareToolWatchTest } from '../../helpers/book-entry-fixture.js';
import { runToolCli, TOOL_ROOT, TOOL_TREE, withoutSolverExitNoise } from '../../helpers/run-tool-cli.js';
import type { CliRun } from '../../helpers/run-tool-cli.js';
import type { ProductRoots } from '../../../lib/model/product/types.js';

const CLI = (name: string): string => path.join(TOOL_ROOT, FRAMEWORK_CLI_DIR, name);
const SAMPLE = path.join(import.meta.dirname, '../../fixtures/samples/library');

/** 1 回の実行は検証・生成の全体を回すので長い。 */
const SLOW = 300_000;

const created: string[] = [];

/** 一時ディレクトリ(macOS の別名を畳んだ実パス。子プロセスの `process.cwd()` と綴りが揃う)。 */
function temp(label: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `cli-outside-${label}-`)));
  created.push(dir);
  return dir;
}

/** 題材を一時ディレクトリへ写す(宣言ごと。生成前の状態)。 */
function copiedSample(): { root: string; roots: ProductRoots } {
  const root = temp('product');
  cpSync(SAMPLE, root, { recursive: true });
  declareToolWatchTest(root);
  const roots = loadProductRoots(root).model.roots;
  if (roots === null) throw new Error(`題材の ${PRODUCT_DECL_FILE} を読めません`);
  return { root, roots };
}

/**
 * 道具を子プロセスで動かす(作業ディレクトリは呼び側が決める。実体は共通の `runToolCli`)。
 *
 * @param extraEnv 子の環境に足す変数(例: `INIT_CWD`。親から継いだ分は `childEnv` が外してある)
 */
function run(
  cli: string,
  cwd: string,
  args: readonly string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): CliRun {
  return runToolCli(CLI(cli), cwd, args, extraEnv);
}

/**
 * 道具の木のファイルの写し(相対パス → 大きさと更新時刻)。`walkFiles` は `node_modules` を歩かない
 * (依存は道具が書く場所ではない)。道具の木に何かが書かれれば、一覧か更新時刻が動く。
 */
function toolTreeSnapshot(): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of walkFiles(TOOL_TREE, () => true)) {
    const stat = statSync(file);
    snapshot.set(toRelative(TOOL_TREE, file), `${String(stat.size)}:${String(stat.mtimeMs)}`);
  }
  return snapshot;
}

/** ディレクトリの直下に 1 つでも項目があるか。 */
function hasEntries(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('withoutSolverExitNoise: 取り除くのは証明器の終了ログの 1 行だけ', () => {
  it('その 1 行(複数回・行頭)は消え、ほかの標準エラーは 1 文字も変わらない', () => {
    const noise = 'received "cleanupThread" command from terminated worker: 1\n';

    expect(withoutSolverExitNoise(`${noise}${noise}`)).toBe('');
    expect(withoutSolverExitNoise(`${noise}エラー: 本当の失敗\n`)).toBe('エラー: 本当の失敗\n');
    expect(withoutSolverExitNoise('エラー: received "cleanupThread" command from terminated worker: 1\n')).toContain('エラー');
    expect(withoutSolverExitNoise('警告: 何か\n')).toBe('警告: 何か\n');
  });
});

describe('道具の木の外から CLI を呼ぶ', () => {
  let sample: { root: string; roots: ProductRoots };
  let before: ReadonlyMap<string, string>;
  beforeAll(() => {
    sample = copiedSample();
    before = toolTreeSnapshot();
  });

  // verify は生成より先に回す(実装の木ができると「仕様だけの題材」ではなくなり、突合の検査が走り出す)。
  it('verify: 作業ディレクトリが製品の木の中なら、道具が別の場所にあっても成功する', { timeout: SLOW }, () => {
    const result = run('verify-docs.ts', sample.root);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('検証結果');
  });

  it('verify: 製品の木の奥のディレクトリから呼んでも、上へ探して同じ根に着く', { timeout: SLOW }, () => {
    const result = run('verify-docs.ts', path.join(sample.root, sample.roots.specs));

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('generate: 生成物が一時ディレクトリの根の宣言の位置(生成物・migration・読み物)に出る', { timeout: SLOW }, () => {
    const result = run('generate-docs.ts', sample.root);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(hasEntries(path.join(sample.root, sample.roots.generated))).toBe(true);
    expect(hasEntries(path.join(sample.root, sample.roots.migrations))).toBe(true);
    expect(hasEntries(path.join(sample.root, sample.roots.book))).toBe(true);
  });

  it('--root: 作業ディレクトリが製品の木の外でも、指した根で動く', { timeout: SLOW }, () => {
    const fresh = copiedSample();
    const outside = temp('outside');

    const result = run('verify-docs.ts', outside, ['--root', fresh.root]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('検証結果');
  });

  it('--root=<path>(`=` 区切り)も受け付ける', { timeout: SLOW }, () => {
    const fresh = copiedSample();
    const outside = temp('outside-equals');

    const result = run('verify-docs.ts', outside, [`--root=${fresh.root}`]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('検証結果');
  });

  it('INIT_CWD: 作業ディレクトリが製品の木の外(取り次ぎの道具の木など)でも、npm の起動場所(INIT_CWD)から根を探す', { timeout: SLOW }, () => {
    const fresh = copiedSample();
    const elsewhere = temp('init-cwd-elsewhere');

    const result = run('verify-docs.ts', elsewhere, [], { INIT_CWD: fresh.root });

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('検証結果');
  });

  it('INIT_CWD: 相対の `--root` と相対のパス引数は、作業ディレクトリではなく INIT_CWD を基準に解く', { timeout: SLOW }, () => {
    const fresh = copiedSample();
    const elsewhere = temp('init-cwd-relative');
    // 起動場所 = 製品の根の親。そこから見た製品の根の相対(`product/`)を渡す。作業ディレクトリ(elsewhere)から
    // 解くと実在しない場所になり、根が決まらずに落ちる。
    const launchDir = path.dirname(fresh.root);
    const relativeRoot = path.relative(launchDir, fresh.root);

    const byRoot = run('verify-docs.ts', elsewhere, ['--root', relativeRoot], { INIT_CWD: launchDir });
    expect(byRoot.stderr).toBe('');
    expect(byRoot.status, byRoot.stdout).toBe(0);

    const domain = path.relative(launchDir, path.join(fresh.root, fresh.roots.specs, 'domain'));
    const byPath = run('verify-docs.ts', elsewhere, [domain], { INIT_CWD: launchDir });
    expect(byPath.stderr).toBe('');
    expect(byPath.status, byPath.stdout).toBe(0);
  });

  it('INIT_CWD が空なら作業ディレクトリから探す(空の値で根が壊れない)', { timeout: SLOW }, () => {
    const fresh = copiedSample();

    const result = run('verify-docs.ts', fresh.root, [], { INIT_CWD: '' });

    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
  });

  it('道具の木には 1 ファイルも書かれていない(ここまでの verify / generate の前後で同じ)', () => {
    expect([...toolTreeSnapshot()]).toEqual([...before]);
  });

  it.each(['verify-docs.ts', 'generate-docs.ts', 'check-migrations.ts', 'spec-diff.ts', 'check-formal.ts', 'samples-db.ts'])(
    '%s: product.md の無い場所から呼ぶと、終了コード 0 でなく「根が見つからない」旨を標準エラーに出す',
    { timeout: SLOW },
    (cli) => {
      const outside = temp('empty');

      const result = run(cli, outside);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(ROOT_MESSAGES.notFound(outside, PRODUCT_DECL_FILE));
    },
  );
});
