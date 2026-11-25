/**
 * `helpers/git-env.ts`(テストが本物の git を起こす隔離の口)の証し(fix22 part 3)。
 *
 * 11-07 の事故の形をそのまま作る: 親の環境の `GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` を**囮のリポジトリ**に向け、
 * 使い捨ての置き場で `init` / `add` / `commit` / `checkout -b` / `config core.bare` を口から回す。囮の git dir のファイルが 1 バイトも変わらず、
 * 置き場の側にコミットが積まれることを見る。囮が本当に効いていること(素の環境の git が囮を指すこと)は、読み取りだけのシェルで確かめる。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnWithDecoyGitEnv } from '../../helpers/git-decoy.js';
import * as port from '../../helpers/git-env.js';
import { gitDirPlace, inheritedGitKeys, isolatedGit, isolatedGitEnv, isolatedGitPinArgs, spawnIsolatedGit, spawnIsolatedNode, withoutGitEnv } from '../../helpers/git-env.js';

const IDENTITY = ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

let base = '';
let decoy = '';
let scratch = '';

/** 置き場の下のファイルの全部の hash(パス → sha256)。 */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      // git の裏の保守(auto maintenance)が一瞬だけ作る `*.lock` は、囮への書き込みではない(読む間に消えて ENOENT になる競合を避ける)。
      if (name.endsWith('.lock')) continue;
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'git-env-')));
  decoy = path.join(base, 'decoy');
  scratch = path.join(base, 'scratch');
  mkdirSync(decoy);
  mkdirSync(scratch);
  // 囮は口で作る(この時点では親の環境に囮の変数は無い)。
  isolatedGit(decoy, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(decoy, 'decoy.txt'), 'decoy\n');
  isolatedGit(decoy, ['add', '-A']);
  isolatedGit(decoy, [...IDENTITY, 'commit', '-q', '-m', 'decoy']);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(base, { recursive: true, force: true });
});

/** 親の環境を pre-commit の中と同じ形にし、リポジトリを決める変数を囮に向ける。 */
function pointParentAtDecoy(): void {
  vi.stubEnv('GIT_DIR', path.join(decoy, '.git'));
  vi.stubEnv('GIT_INDEX_FILE', path.join(decoy, '.git/index'));
  vi.stubEnv('GIT_WORK_TREE', decoy);
  vi.stubEnv('GIT_COMMON_DIR', path.join(decoy, '.git'));
}

describe('囮の GIT_DIR の証し(11-07 の事故の形)', () => {
  it('囮は効いている: 囮の変数を継いだ git は囮の git dir を指す(読み取りだけで確かめる)', () => {
    mkdirSync(path.join(base, 'home'));
    const bare = spawnWithDecoyGitEnv(decoy, 'sh', ['-c', 'git rev-parse --absolute-git-dir'], { cwd: scratch, home: path.join(base, 'home') });
    expect(realpathSync(bare.stdout.trim())).toBe(realpathSync(path.join(decoy, '.git')));
  });

  it('口から回した init / add / commit / checkout -b / config は囮に 1 バイトも書かず、置き場に積む', () => {
    const before = snapshot(path.join(decoy, '.git'));
    pointParentAtDecoy();
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    writeFileSync(path.join(scratch, 'a.txt'), 'a\n');
    isolatedGit(scratch, ['add', '-A']);
    isolatedGit(scratch, [...IDENTITY, 'commit', '-q', '-m', 'scratch']);
    isolatedGit(scratch, ['checkout', '-q', '-b', 'fix']);
    isolatedGit(scratch, ['config', 'core.bare', 'false']);
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
    expect(isolatedGit(scratch, ['log', '--format=%s']).trim()).toBe('scratch');
    expect(isolatedGit(scratch, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('fix');
    expect(gitDirPlace(scratch, isolatedGitEnv(scratch))).toEqual({ kind: 'inside' });
  });

  it('置き場の .git が囮を指す(gitfile)なら、書き込みうる命令を起こさずに断り、囮は変わらない', () => {
    writeFileSync(path.join(scratch, '.git'), `gitdir: ${path.join(decoy, '.git')}\n`);
    writeFileSync(path.join(scratch, 'b.txt'), 'b\n');
    const before = snapshot(path.join(decoy, '.git'));
    for (const args of [['add', '-A'], ['init', '-q'], [...IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'x'], ['config', 'core.bare', 'true']]) {
      expect(() => spawnIsolatedGit(scratch, args), args.join(' ')).toThrow(/置き場の外/);
    }
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
  });

  it('置き場の上のリポジトリは探さない(GIT_CEILING_DIRECTORIES)。リポジトリでない置き場の書き込みは断る', () => {
    const inner = path.join(decoy, 'inner');
    mkdirSync(inner);
    expect(spawnIsolatedGit(inner, ['rev-parse', '--git-dir']).status).not.toBe(0);
    expect(() => spawnIsolatedGit(inner, ['add', '-A'])).toThrow(/リポジトリではありません/);
    expect(isolatedGitEnv(inner)['GIT_CEILING_DIRECTORIES']).toBe(decoy);
  });
});

describe('引数と環境の断り', () => {
  it.each([
    ['-C', ['-C', '/elsewhere', 'status']],
    ['--git-dir=', ['--git-dir=/elsewhere/.git', 'add', '-A']],
    ['--git-dir の値の別引数', ['--git-dir', '/elsewhere/.git', 'add', '-A']],
    ['--work-tree', ['--work-tree=/elsewhere', 'add', '-A']],
    ['読めない大域の指定', ['-p', 'log']],
    ['命令が無い', ['-c', 'a=b']],
    ['init の場所の引数', ['init', '-q', '/elsewhere']],
    ['init の --separate-git-dir', ['init', '--separate-git-dir=/elsewhere/.git']],
    ['init の --bare', ['init', '--bare']],
    ['clone の行き先が置き場そのものでない', ['clone', '--quiet', 'file:///x', 'other']],
    ['clone の --reference', ['clone', '--reference', '/elsewhere', 'file:///x', '.']],
  ] as const)('%s は起こさずに断る', (_name, args) => {
    expect(() => spawnIsolatedGit(scratch, args)).toThrow(/隔離した git/);
  });

  it('clone は置き場そのもの(`.`)へなら通り、後で git dir が中にあることを確かめる', () => {
    isolatedGit(scratch, ['clone', '--quiet', '--depth', '1', `file://${decoy}`, '.']);
    expect(gitDirPlace(scratch, isolatedGitEnv(scratch))).toEqual({ kind: 'inside' });
    expect(readFileSync(path.join(scratch, 'decoy.txt'), 'utf-8')).toBe('decoy\n');
  });

  it.each(['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_CEILING_DIRECTORIES', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'])('足す変数の %s(外を指す値)は断る', (key) => {
    expect(() => isolatedGitEnv(scratch, { [key]: '/elsewhere' })).toThrow(/足せません/);
  });

  it('作者・設定の切り離しの変数と GIT_ でない変数は足せる', () => {
    const env = isolatedGitEnv(scratch, { GIT_AUTHOR_NAME: 'a', GIT_COMMITTER_EMAIL: 'c@x', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SKIP_GATES: '' });
    expect(env).toMatchObject({ GIT_AUTHOR_NAME: 'a', GIT_COMMITTER_EMAIL: 'c@x', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SKIP_GATES: '' });
  });

  it('withoutGitEnv は GIT_ で始まる変数を表に依らず全部外す・inheritedGitKeys はその名前を返す', () => {
    const parent = { GIT_DIR: 'd', GIT_INDEX_FILE: 'i', GIT_SOMETHING_NEW: 'n', PATH: '/bin', HOME: '/h' };
    expect(withoutGitEnv(parent)).toEqual({ PATH: '/bin', HOME: '/h' });
    expect(inheritedGitKeys(parent)).toEqual(['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_SOMETHING_NEW']);
    expect(Object.keys(isolatedGitEnv(scratch, {}, parent)).sort()).toEqual(['GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_DIR', 'GIT_OPTIONAL_LOCKS', 'GIT_WORK_TREE', 'HOME', 'PATH']);
  });

  it('isolatedGit は失敗を標準エラーつきの例外にし、spawnIsolatedGit は結果を返す', () => {
    expect(() => isolatedGit(decoy, ['rev-parse', 'no-such-ref'])).toThrow(/git rev-parse no-such-ref が失敗しました/);
    expect(spawnIsolatedGit(decoy, ['rev-parse', 'no-such-ref']).status).not.toBe(0);
  });
});

/**
 * 書き込みの行き先を閉じる(点検 23 回目 C23-3)。git dir が置き場の中を指していても、引数で行き先を名指せば外へ書けた
 * (`config --global` → 利用者の大域の設定・`push` / `config --file` → 囮・`worktree add` / `diff --output` → 置き場の外)。
 * 命令は「読み取り」「置き場の中だけに書く」の 2 つの閉じた表にあるものだけを起こし、表の外と、外を名指す指定は断る。
 */
describe('書き込みの行き先の断り(C23-3)', () => {
  let home = '';
  let outside = '';

  beforeEach(() => {
    home = path.join(base, 'home');
    outside = path.join(base, 'outside');
    mkdirSync(home);
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    writeFileSync(path.join(scratch, 'h.txt'), 'h\n');
    isolatedGit(scratch, ['add', '-A']);
    isolatedGit(scratch, [...IDENTITY, 'commit', '-q', '-m', 's']);
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', path.join(home, '.config'));
  });

  it.each([
    ['config --global', () => ['config', '--global', 'user.name', 'pwned']],
    ['config --system', () => ['config', '--system', 'user.name', 'pwned']],
    ['config --file 囮', () => ['config', '--file', path.join(decoy, '.git/config'), 'core.bare', 'true']],
    ['config -f 囮', () => ['config', '-f', path.join(decoy, '.git/config'), 'core.bare', 'true']],
    ['config --file=囮', () => ['config', `--file=${path.join(decoy, '.git/config')}`, 'core.bare', 'true']],
    ['config core.worktree 外', () => ['config', 'core.worktree', outside]],
    ['config include.path', () => ['config', 'include.path', path.join(decoy, '.git/config')]],
    ['push 囮へ', () => ['push', '-q', path.join(decoy, '.git'), 'HEAD:refs/heads/pushed']],
    ['fetch', () => ['fetch', '-q', path.join(decoy, '.git')]],
    ['worktree add 外へ', () => ['worktree', 'add', '-q', outside]],
    ['submodule add', () => ['submodule', 'add', `file://${decoy}`, 'sub']],
    ['-c core.worktree=外 checkout', () => ['-c', `core.worktree=${outside}`, 'checkout', '-f', '--', '.']],
    ['-c include.path', () => ['-c', `include.path=${path.join(decoy, '.git/config')}`, 'status']],
    ['-c core.hooksPath=外', () => ['-c', `core.hooksPath=${outside}`, 'commit', '--allow-empty', '-m', 'x']],
    ['-c core.fsmonitor', () => ['-c', 'core.fsmonitor=touch /x', 'status']],
    ['diff --output=外', () => ['diff', 'HEAD', `--output=${path.join(base, 'diff-out.txt')}`]],
    ['diff --output 外', () => ['diff', 'HEAD', '--output', path.join(base, 'diff-out.txt')]],
    ['log --output=外', () => ['log', `--output=${path.join(base, 'log-out.txt')}`]],
    ['format-patch -o 外', () => ['format-patch', '-o', outside, 'HEAD~0']],
    ['archive --output 外', () => ['archive', `--output=${path.join(base, 'a.tar')}`, 'HEAD']],
    ['bundle create 外', () => ['bundle', 'create', path.join(base, 'b.bundle'), 'HEAD']],
    ['grep の -O(ページャの起動)', () => ['grep', '-Otouch', 'h']],
    ['grep --open-files=(ページャの指定の略記。C25-2)', () => ['grep', `--open-files=touch ${path.join(base, 'MARK1')};:`, '-e', 'h']],
    ['grep --open=(さらに短い略記。C25-2)', () => ['grep', `--open=touch ${path.join(base, 'MARK2')};:`, '-e', 'h']],
    ['grep -iO(束ねた短い指定。C25-2)', () => ['grep', `-iOtouch ${path.join(base, 'MARK3')};:`, '-e', 'h']],
    ['apply --unsafe-paths(置き場の外へ書く。C25-2)', () => ['apply', '--unsafe-paths', 'p.patch']],
    ['apply --directory(置き場の外へ書く)', () => ['apply', `--directory=${outside}`, 'p.patch']],
    ['merge -s(PATH の git-merge-<名前> を起こす)', () => ['merge', '-s', 'evil', 'HEAD']],
    ['merge --strategy=', () => ['merge', '--strategy=evil', 'HEAD']],
    ['log --out=(略記の --output)', () => ['log', `--out=${path.join(base, 'log-out.txt')}`]],
    ['log -n の詰めた値でない詰め方(-p<値> は表の外)', () => ['log', '-pHEAD']],
    ['表に指定の無い命令の指定', () => ['write-tree', '--prefix=x']],
  ] as const)('%s は起こさずに断り、外も囮も変わらない', (_name, args) => {
    const before = snapshot(path.join(decoy, '.git'));

    expect(() => spawnIsolatedGit(scratch, args())).toThrow(/隔離した git/);
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(base).sort()).toEqual(['decoy', 'home', 'scratch']);
  });

  it('置き場の中だけに書く命令(add / commit / checkout / branch / tag / config の許した鍵・置き場の中のフックの置き場)は通る', () => {
    writeFileSync(path.join(scratch, 'i.txt'), 'i\n');
    for (const args of [['add', 'i.txt'], [...IDENTITY, 'commit', '-q', '-m', 'i'], [...IDENTITY, 'commit', '-qm', 'i2', '--allow-empty'], ['log', '-Sh', '--format=%H', '-n', '1'], ['status', '--porcelain=v1', '--untracked-files=all'], ['grep', '-n', '-e', 'h'], ['checkout', '-q', '-b', 'b2'], ['branch', 'b3'], ['tag', 't1'], ['config', 'core.bare', 'false'], ['config', '--local', 'user.name', 't'], ['config', '--get', 'user.name'], ['config', 'core.hooksPath', '.githooks'], ['-c', 'core.hooksPath=/dev/null', 'status']]) {
      expect(spawnIsolatedGit(scratch, args).status, args.join(' ')).toBe(0);
    }
  });

  it('利用者の大域の設定(HOME の .gitconfig・XDG の git/config)を子に効かせない', () => {
    writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = leak-home\n');
    mkdirSync(path.join(home, '.config/git'), { recursive: true });
    writeFileSync(path.join(home, '.config/git/config'), '[user]\n\temail = leak@xdg\n');

    expect(spawnIsolatedGit(scratch, ['config', 'user.name']).stdout.trim()).toBe('');
    expect(spawnIsolatedGit(scratch, ['config', 'user.email']).stdout.trim()).toBe('');
  });
});

/**
 * 口の環境がリポジトリを置き場に固定する(点検 24 回目 C24-1)。`GIT_CEILING_DIRECTORIES` は「上へ探す」のを止めるだけで、cwd 自身と天井までの間は探すので、
 * `cwd` を書き忘れた子の git は作業ディレクトリ(vitest では本物のリポジトリの中)に当たった。口は `GIT_DIR=<置き場>/.git`・`GIT_WORK_TREE=<置き場>` を置く。
 * cwd を書き忘れた子そのものはこのファイルでは起こさない(ワーカーの cwd は本物のリポジトリの中)。囮の中を作業ディレクトリにした実物の証しは
 * `dev-repo/unit/model/config/test-git-guard.test.ts` の実行時の節(PORT_ENV_DECOYS)が持つ。
 */
describe('リポジトリの固定(C24-1)', () => {
  it('口の環境は GIT_DIR と GIT_WORK_TREE を置き場に置く(足す変数で上書きできない)', () => {
    const env = isolatedGitEnv(scratch);
    expect(env['GIT_DIR']).toBe(path.join(scratch, '.git'));
    expect(env['GIT_WORK_TREE']).toBe(scratch);
    expect(() => isolatedGitEnv(scratch, { GIT_DIR: path.join(scratch, '.git') })).toThrow(/足せません/);
  });

  it('置き場の下の別の作業ディレクトリから読んでも、置き場のリポジトリを指す', () => {
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    expect(realpathSync(isolatedGit(scratch, ['rev-parse', '--path-format=absolute', '--show-toplevel']).trim())).toBe(scratch);
  });

  it('clone は置き場そのものへ作り、作った後も git dir が置き場の中にある(GIT_WORK_TREE があると git clone は断るので、作る間だけ外す)', () => {
    isolatedGit(scratch, ['clone', '--quiet', `file://${decoy}`, '.']);
    expect(gitDirPlace(scratch, isolatedGitEnv(scratch))).toEqual({ kind: 'inside' });
    expect(isolatedGit(scratch, ['log', '--format=%s']).trim()).toBe('decoy');
  });

  it('置き場が開発用リポジトリの木の中なら、書き込みうる命令を起こさずに断る(読み取りは通す)', () => {
    const tree = fileURLToPath(new URL('../../../../../', import.meta.url));
    for (const args of [['checkout', '-b', 'x'], ['config', 'core.bare', 'true'], ['commit', '--allow-empty', '-m', 'x'], ['init']]) {
      expect(() => port.checkIsolatedGitArgs(tree, args), args.join(' ')).toThrow(/開発用リポジトリ/);
    }
    expect(() => port.checkIsolatedGitArgs(tree, ['ls-files'])).not.toThrow();
  });
});

/**
 * 引数の読みを git の parse-options に合わせる(点検 24 回目 C24-2)。詰めた短い指定(`-f<パス>`)と長い指定の一意な略記(`--fil=`・`--syst`)が
 * 字面の表を通り、`config <鍵> get` は値の位置の `get` を読み取りと誤読した。`config` / `init` / `clone` の指定は閉じた表の完全一致だけを許し、表の外は断る。
 * 断るべき引数は `checkIsolatedGitArgs`(子を起こさない読み)で見る —— 直す前の口では git が本当に走り、system の設定にまで書きうるため。
 */
describe('シェルの口(C24-1。フックや CI の判定の台本を本物のシェルで回すテストは、直の sh / bash でなくこの口から)', () => {
  it('作業ディレクトリは置き場で、台本が別の場所へ cd しても台本の git は置き場のリポジトリに固定される(囮は変わらない)', () => {
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    const before = snapshot(path.join(decoy, '.git'));
    const run = port.spawnIsolatedShell(scratch, ['-c', `pwd -P; cd "${decoy}" && git config core.bare true && git checkout -q -b fix`], { extraEnv: { X: '1' } });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(scratch);
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
    expect(isolatedGit(scratch, ['config', 'core.bare']).trim()).toBe('true');
  });

  it('置き場がリポジトリでなければ、台本の git は上のリポジトリを探さずに失敗する', () => {
    const inner = path.join(decoy, 'inner');
    mkdirSync(inner);
    const run = port.spawnIsolatedShell(inner, ['-c', 'git rev-parse --git-dir'], { shell: 'bash' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not a git repository/);
  });

  it('元の環境を差し替えられる(足す変数と固定の変数は残る)', () => {
    const run = port.spawnIsolatedShell(scratch, ['-c', 'echo "$PATH|${HOME-unset}|$GIT_DIR"'], { baseEnv: { PATH: '/usr/bin:/bin' } });
    expect(run.stdout.trim()).toBe(`/usr/bin:/bin|unset|${path.join(scratch, '.git')}`);
  });

  it('置き場が開発用リポジトリの木の中なら、同期も非同期も起こさずに断る', () => {
    const tree = fileURLToPath(new URL('../../../../../', import.meta.url));
    expect(() => port.spawnIsolatedShell(tree, ['-c', 'true'])).toThrow(/開発用リポジトリの木の中/);
    expect(() => port.startIsolatedShell(tree, ['-c', 'true'])).toThrow(/開発用リポジトリの木の中/);
  });

  it('非同期の形は子を返し、終わりを待てる', async () => {
    const child = port.startIsolatedShell(scratch, ['-c', 'exit 3'], { stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => child.once('exit', (exitCode) => resolve(exitCode)));
    expect(code).toBe(3);
  });
});

describe('引数の読みと parse-options(C24-2)', () => {
  it.each([
    ['config -f<パス>(詰めた短い指定)', ['config', '-f/elsewhere/config', 'core.bare', 'true']],
    ['config --fil=<パス>(長い指定の略記)', ['config', '--fil=/elsewhere/config', 'user.name', 'pwned']],
    ['config --fi <パス>', ['config', '--fi', '/elsewhere/config', 'user.name', 'pwned']],
    ['config --syst(--system の略記)', ['config', '--syst', 'user.name', 'pwned']],
    ['config --glob(--global の略記)', ['config', '--glob', 'user.name', 'pwned']],
    ['config --sys=', ['config', '--sys', 'user.name', 'pwned']],
    ['config --blo=', ['config', '--blo=HEAD:x', 'user.name']],
    ['config の表の外の短い指定の束ね', ['config', '-lf', '/elsewhere/config']],
    ['config 値の位置の get(読み取りでない)', ['config', 'core.fsmonitor', 'get']],
    ['config 値の位置の list', ['config', 'core.fsmonitor', 'list']],
    ['config set の値に get', ['config', 'set', 'core.fsmonitor', 'get']],
    ['config --edit', ['config', '--edit']],
    ['init --separate=(略記)', ['init', '--separate=/elsewhere/.git']],
    ['init --bar(--bare の略記)', ['init', '--bar']],
    ['init --templ=(表の外)', ['init', '--templ=/elsewhere']],
    ['init -bmain(詰めた値)', ['init', '-bmain']],
    ['clone --ref <外>(--reference の略記)', ['clone', '--ref', '/elsewhere', 'file:///x', '.']],
    ['clone --mirr', ['clone', '--mirr', 'file:///x', '.']],
    ['clone -ccore.worktree=外(詰めた -c)', ['clone', '-ccore.worktree=/elsewhere', 'file:///x', '.']],
    ['clone --conf core.worktree=外', ['clone', '--conf', 'core.worktree=/elsewhere', 'file:///x', '.']],
    ['clone --separate-git-dir の略記', ['clone', '--sep=/elsewhere', 'file:///x', '.']],
  ] as const)('%s は断る', (_name, args) => {
    expect(() => port.checkIsolatedGitArgs(scratch, args)).toThrow(/隔離した git/);
  });

  it.each([
    ['config の鍵と値', ['config', 'core.bare', 'false']],
    ['config --local', ['config', '--local', 'user.name', 't']],
    ['config --get', ['config', '--get', 'user.name']],
    ['config --get の鍵は表に依らず読める', ['config', '--get', 'remote.origin.url']],
    ['config -l', ['config', '-l']],
    ['config --list', ['config', '--list']],
    ['config get(新しい書き方の読み取り)', ['config', 'get', 'remote.origin.url']],
    ['config --unset', ['config', '--unset', 'user.name']],
    ['config -- の後ろは位置引数', ['config', '--', 'user.name', '-x']],
    ['init -q -b main', ['init', '-q', '-b', 'main']],
    ['init --quiet --initial-branch=main', ['init', '--quiet', '--initial-branch=main']],
    ['clone --quiet --depth 1', ['clone', '--quiet', '--depth', '1', 'file:///x', '.']],
    ['clone --depth=1 -b main', ['clone', '--depth=1', '-b', 'main', 'file:///x', '.']],
  ] as const)('%s は通す', (_name, args) => {
    expect(() => port.checkIsolatedGitArgs(scratch, args)).not.toThrow();
  });

  it('実物: 詰めた -f と略記の --fil= は囮の設定に書かずに断り、値の位置の get は置き場の設定を変えない', () => {
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    const before = snapshot(path.join(decoy, '.git'));
    const config = readFileSync(path.join(scratch, '.git/config'), 'utf-8');
    for (const args of [['config', `-f${path.join(decoy, '.git/config')}`, 'core.bare', 'true'], ['config', `--fil=${path.join(decoy, '.git/config')}`, 'user.name', 'pwned'], ['config', 'core.fsmonitor', 'get']]) {
      expect(() => spawnIsolatedGit(scratch, args), args.join(' ')).toThrow(/隔離した git/);
    }
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
    expect(readFileSync(path.join(scratch, '.git/config'), 'utf-8')).toBe(config);
  });
});

describe('口の固定を引数でも(C25-1 (b))', () => {
  it('git の引数の頭に置き場の --git-dir / --work-tree を置く(clone は -C)', () => {
    expect(isolatedGitPinArgs(scratch, 'commit')).toEqual([`--git-dir=${path.join(scratch, '.git')}`, `--work-tree=${scratch}`]);
    expect(isolatedGitPinArgs(scratch, 'init')).toEqual([`--git-dir=${path.join(scratch, '.git')}`, `--work-tree=${scratch}`]);
    expect(isolatedGitPinArgs(scratch, 'clone')).toEqual(['-C', scratch]);
  });

  it('引数の固定の下の init は core.worktree を書かず、置き場に積む', () => {
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    expect(readFileSync(path.join(scratch, '.git/config'), 'utf-8')).not.toMatch(/worktree/);
    expect(isolatedGit(scratch, ['rev-parse', '--show-toplevel']).trim()).toBe(scratch);
  });

  it('node の子の口は作業ディレクトリを置き場にし、GIT_ を外す孫の git も置き場に当たる(囮は変わらない)', () => {
    isolatedGit(scratch, ['init', '-q', '-b', 'main']);
    const before = snapshot(path.join(decoy, '.git'));
    const code = "const { execSync } = require('node:child_process'); const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))); execSync('git config core.bare true', { env });";
    const run = spawnIsolatedNode(scratch, ['-e', code]);
    expect(run.status, run.stderr).toBe(0);
    expect(snapshot(path.join(decoy, '.git'))).toEqual(before);
    expect(isolatedGit(scratch, ['config', '--get', 'core.bare']).trim()).toBe('true');
  });

  it('node の子の口は、置き場が開発用リポジトリの木の中なら起こさない', () => {
    expect(() => spawnIsolatedNode(fileURLToPath(new URL('.', import.meta.url)), ['-e', '0'])).toThrow(/隔離した node: 置き場 .* が開発用リポジトリの木の中/);
  });
});
