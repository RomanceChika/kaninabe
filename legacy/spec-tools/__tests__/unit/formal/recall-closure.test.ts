/**
 * 旧い閉包の git からの復元(`recallClosure`)のテスト。
 *
 * 復元は「`git log -S<宣言の hash>` でその行を書いたコミットを探し、そのコミットの版で閉包を計算し直す」
 * 段取りで、`git log` の出力と `git show <commit>:<path>` の答え方に依る —— 手で書いた文字列では再現した
 * つもりになりやすい。そこで**使い捨ての git リポジトリを実際に作って**通す(環境変数の外し方は
 * `helpers/git-env.ts`)。復元は**読むだけ**でなければならないので、回した git の引数を全部記録して
 * 書き込み系(`add` / `commit` / `checkout` / `reset` / `restore` / `stash` …)が 1 本も無いことも見る。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recallClosure, worktreeReader } from '../../../cli/formal-sources-io.js';
import type { Git } from '../../../cli/diff-io.js';
import { computeClosure } from '../../../lib/semantics/import-closure.js';
import type { SourceDeclaration } from '../../../lib/formal/types.js';
import { isolatedGit, spawnIsolatedGit } from '../../helpers/git-env.js';

/** 実装の木のソースの根を `src` に置く別名(`@/…` の綴りは配置が与える形)。 */
const SRC_ALIAS = { prefix: '@/', dir: 'src' } as const;
const TLA = 'formal/M.tla';
const ENTRY = 'lib/entry.ts';

/** 使い捨てリポジトリの置き場とその複製(テストごとに作り直す)。 */
let repo = '';
let clone = '';

/** 使い捨てリポジトリで**書き込みを含む** git を回す(準備用。フックも署名も無効にして環境に依存させない)。 */
function git(cwd: string, ...args: string[]): string {
  return isolatedGit(cwd, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args]);
}

/** 復元に渡す git の口(**読み取りの口**。回した引数を記録し、親の環境のリポジトリ変数は外す)。 */
function recordingGit(cwd: string, calls: string[][]): Git {
  return (args) => {
    calls.push([...args]);
    const result = spawnIsolatedGit(cwd, args);
    return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false, reason: `git ${args.join(' ')} が失敗しました: ${result.stderr}` };
  };
}

/** ファイルを書く(親ディレクトリは作る)。 */
function write(relative: string, body: string): void {
  const absolute = path.join(repo, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf-8');
}

/** 作業ツリーの閉包の hash。 */
function hashOf(entry = ENTRY): string {
  return computeClosure(entry, worktreeReader(repo))?.hash ?? '';
}

/** 宣言(`.tla` の `SOURCE:` 行)を書いて全部をコミットする。 */
function commitDeclaring(declared: string, message: string): void {
  write(TLA, `\\* SOURCE: ${ENTRY} ${declared}\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', message);
}

const declaration = (sha256: string, target = ENTRY): SourceDeclaration => ({ kind: 'path', target, sha256, line: 1 });

/** 書き込み系の git(復元が呼んではならないもの)。 */
const WRITING = new Set(['add', 'commit', 'checkout', 'reset', 'restore', 'stash', 'rm', 'mv', 'clean', 'merge', 'rebase', 'push', 'fetch', 'pull']);

/** 回した git のサブコマンド(先頭の `-c k=v` などの指定は読み飛ばす)。 */
function subcommands(calls: readonly string[][]): string[] {
  return calls.map((args) => args.find((arg) => !arg.startsWith('-')) ?? '');
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'recall-closure-'));
  git(repo, 'init', '--quiet', '-b', 'main');
  write(ENTRY, "import { leaf } from './leaf.js';\nexport const entry = leaf;\n");
  write('lib/leaf.ts', 'export const leaf = 1;\n');
});

afterEach(() => {
  for (const dir of [repo, clone]) if (dir !== '') rmSync(dir, { recursive: true, force: true });
  repo = '';
  clone = '';
});

describe('recallClosure(使い捨ての git リポジトリ)', () => {
  it('宣言を書いたコミットの版から閉包を復元する(その後で葉が動いていても旧い側が取れる)', () => {
    const declared = hashOf();
    const oldFiles = computeClosure(ENTRY, worktreeReader(repo))?.files;
    commitDeclaring(declared, '宣言を書く');
    write('lib/leaf.ts', 'export const leaf = 2;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', '葉だけを動かす(宣言は古いまま)');

    const calls: string[][] = [];
    const recalled = recallClosure(recordingGit(repo, calls), TLA, declaration(declared), null);

    expect(recalled).toEqual(oldFiles);
    expect(recalled?.map((file) => file.path)).toEqual(['lib/entry.ts', 'lib/leaf.ts']);
    expect(hashOf()).not.toBe(declared);
  });

  it('復元は読むだけ(書き込み系の git を 1 本も回さない)', () => {
    const declared = hashOf();
    commitDeclaring(declared, '宣言を書く');
    const before = git(repo, 'status', '--porcelain=v1', '--untracked-files=all');
    const headBefore = git(repo, 'rev-parse', 'HEAD');

    const calls: string[][] = [];
    recallClosure(recordingGit(repo, calls), TLA, declaration(declared), null);

    expect(calls.length).toBeGreaterThan(0);
    expect(subcommands(calls).filter((name) => WRITING.has(name))).toEqual([]);
    expect(new Set(subcommands(calls))).toEqual(new Set(['log', 'show']));
    expect(git(repo, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(before);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
  });

  it('履歴にその hash を入れたコミットが無ければ null(推測で埋めない)', () => {
    commitDeclaring(hashOf(), '宣言を書く');

    expect(recallClosure(recordingGit(repo, []), TLA, declaration('f'.repeat(64)), null)).toBeNull();
  });

  it('浅い clone(`--depth 1`)では宣言の版へ遡れないので null', () => {
    const declared = hashOf();
    commitDeclaring(declared, '宣言を書く');
    write('lib/leaf.ts', 'export const leaf = 2;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', '葉だけを動かす');
    clone = mkdtempSync(path.join(tmpdir(), 'recall-closure-shallow-'));
    git(clone, 'clone', '--quiet', '--depth', '1', `file://${repo}`, '.');
    expect(git(clone, 'rev-list', '--count', 'HEAD').trim()).toBe('1');

    expect(recallClosure(recordingGit(clone, []), TLA, declaration(declared), null)).toBeNull();
  });

  it('ディレクトリ import(`./dir` → `dir/index.ts`)を含む閉包は復元しない(null。誤った閉包を返さない)', () => {
    write(ENTRY, "export * from './dir';\n");
    write('lib/dir/index.ts', 'export const d = 1;\n');
    const declared = hashOf();
    expect(computeClosure(ENTRY, worktreeReader(repo))?.files.map((file) => file.path)).toEqual(['lib/dir/index.ts', ENTRY]);
    commitDeclaring(declared, '宣言を書く');

    expect(recallClosure(recordingGit(repo, []), TLA, declaration(declared), null)).toBeNull();
  });

  it('`@/…` を含む閉包は、実装の木の根を渡せば復元でき、渡さなければ(別の閉包なので)復元しない', () => {
    write(ENTRY, "import { x } from '@/shared/x';\nexport const entry = x;\n");
    write('src/shared/x.ts', 'export const x = 1;\n');
    const declared = computeClosure(ENTRY, worktreeReader(repo), SRC_ALIAS)?.hash ?? '';
    commitDeclaring(declared, '宣言を書く');

    expect(recallClosure(recordingGit(repo, []), TLA, declaration(declared), SRC_ALIAS)?.map((file) => file.path)).toEqual([
      ENTRY,
      'src/shared/x.ts',
    ]);
    expect(recallClosure(recordingGit(repo, []), TLA, declaration(declared), null)).toBeNull();
  });
});
