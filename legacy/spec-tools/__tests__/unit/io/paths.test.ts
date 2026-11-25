/**
 * I/O の小道具(lib/io/paths.ts)のうち、**仕様と実装の突合が成立する環境か**の判定
 * (`appGrounded`)と、**リポジトリルートの決め方**(`detectRepoRoot`)のテスト。
 *
 * 対象の要求: scripts-code-quality.md §I/O と純粋ロジックの分離 —— 「実装の木があるか」は
 * 仕様だけを持つリポジトリ(サンプル・実装をまだ書いていない新規プロジェクト)を正当な形と
 * 扱うための判定であり、X1 / J2 / G8 が同じ 1 本を共有する(束 ⑲-1)。束 ①-a で判定は
 * 2 段になった —— **宣言していない**(別スタック)と**宣言したがまだ無い**(生成前)は
 * どちらも「突合できない」であり、どちらもエラーではない。
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { FRAMEWORK_OUTPUT_PATHS, outputPathsUnder } from '../../../lib/io/output-paths.js';
import { appGrounded, detectRepoRoot, entryKindOf, PRODUCT_DECL_FILE, realpathLoose, walkFiles } from '../../../lib/io/paths.js';
import { walkTree } from '../../../lib/io/walk-tree.js';
import type { WalkFs } from '../../../lib/io/walk-tree.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** このリポジトリのルート(実装の木を持つ)。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** 仕様だけを持つ木(fixtures のサンプル)。 */
const SPEC_ONLY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/samples/library',
);

describe('appGrounded', () => {
  const cleanups: string[] = [];
  afterAll(() => {
    for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
  });

  it('宣言した実装の木が実在すれば true', () => {
    const app = TEST_ROOTS.app;
    if (app === null) throw new Error('テストの前提: 製品の根の宣言が実装の木(app)を持つ');
    const repo = mkdtempSync(path.join(realpathSync(tmpdir()), 'app-grounded-'));
    cleanups.push(repo);
    mkdirSync(path.join(repo, app), { recursive: true });

    expect(appGrounded(repo, app)).toBe(true);
  });

  it('宣言した実装の木が無ければ false(飛ばす判断の根拠になる)', () => {
    expect(appGrounded(SPEC_ONLY, TEST_ROOTS.app)).toBe(false);
  });

  it('実装の木を宣言していなければ木の有無を見ずに false', () => {
    expect(appGrounded(REPO_ROOT, null)).toBe(false);
  });

  it('存在しないパスでも落ちずに false', () => {
    expect(appGrounded(path.join(SPEC_ONLY, 'ghost'), TEST_ROOTS.app)).toBe(false);
  });
});

describe('detectRepoRoot', () => {
  it('宣言ファイルを上へ探してリポジトリルートを決める', () => {
    expect(detectRepoRoot(path.join(REPO_ROOT, 'docs', 'scripts', 'lib'))).toBe(REPO_ROOT);
  });

  it('宣言ファイルを持つ fixture では、その木の根で止まる(ホストまで登らない)', () => {
    expect(detectRepoRoot(path.join(SPEC_ONLY, 'docs', 'specs'))).toBe(SPEC_ONLY);
  });

  it('宣言ファイル名は 1 つだけ(仕組みが持ってよい唯一の綴り)', () => {
    expect(PRODUCT_DECL_FILE).toBe('product.md');
  });
});

describe('entryKindOf / realpathLoose: 別名(シンボリックリンク)を辿らずに見る・実在しない場所も畳む', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'paths-link-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'real'));
  writeFileSync(path.join(dir, 'real/file.txt'), 'x');
  symlinkSync(path.join(dir, 'real'), path.join(dir, 'alias'));
  symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling'));

  it('通常のファイル・ディレクトリは other、無ければ absent、別名は(宙ぶらりんも)symlink。別名の先は辿らない', () => {
    expect(entryKindOf(path.join(dir, 'real'))).toBe('other');
    expect(entryKindOf(path.join(dir, 'real/file.txt'))).toBe('other');
    expect(entryKindOf(path.join(dir, 'missing'))).toBe('absent');
    expect(entryKindOf(path.join(dir, 'alias'))).toBe('symlink');
    expect(entryKindOf(path.join(dir, 'dangling'))).toBe('symlink');
    expect(entryKindOf(path.join(dir, 'alias/file.txt'))).toBe('other');
  });

  it('別名は実体に畳み、実在しない場所はいちばん近い実在の祖先を畳んで残りを足す', () => {
    expect(realpathLoose(path.join(dir, 'alias/file.txt'))).toBe(path.join(dir, 'real/file.txt'));
    expect(realpathLoose(path.join(dir, 'alias/new/deeper.md'))).toBe(path.join(dir, 'real/new/deeper.md'));
    expect(realpathLoose(path.join(dir, 'real'))).toBe(path.join(dir, 'real'));
  });

  // 大文字小文字を区別しないファイルシステム(macOS の既定)では、綴りが違うだけのパスも同じ実体。区別する環境では前提が成り立たないので飛ばす
  // (小文字にしたパスが実際に在るかで判定する。在らなければ別の実体として畳まれるのが正しい)。
  const mixed = path.join(dir, 'MixedCase');
  mkdirSync(mixed);
  const lower = mixed.toLowerCase();
  const insensitive = lower !== mixed && existsSync(lower);
  it.skipIf(!insensitive)('大文字小文字だけ違う綴りは、ディスク上の綴りに畳む(実在するものも・実在しない子も)', () => {
    expect(realpathLoose(lower)).toBe(mixed);
    expect(realpathLoose(path.join(lower, 'new/deeper.md'))).toBe(path.join(mixed, 'new/deeper.md'));
  });
});

describe('walkTree(名前でディレクトリを飛ばさない走査)', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  /** 一時ディレクトリに木を組む(`files` はルートからの相対パス)。 */
  function tree(files: readonly string[]): string {
    const root = mkdtempSync(path.join(tmpdir(), 'walk-tree-'));
    made.push(root);
    for (const file of files) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), '');
    }
    return root;
  }

  const relatives = (root: string, found: readonly string[]): string[] => found.map((file) => path.relative(root, file).split(path.sep).join('/'));

  it('walkTree は何も飛ばさない(点検 14 回目 C14-1)', () => {
    const root = tree(['a.txt', '.well-known/x.txt', 'build/b.txt', 'coverage/c.txt', 'dist/d.txt', '.next/n.txt', 'node_modules/p/e.txt', 'z/node_modules/f.txt', 'ok\nname/g.txt']);

    expect(relatives(root, walkTree(root).files)).toEqual(['.next/n.txt', '.well-known/x.txt', 'a.txt', 'build/b.txt', 'coverage/c.txt', 'dist/d.txt', 'node_modules/p/e.txt', 'ok\nname/g.txt', 'z/node_modules/f.txt']);
  });

  it('walkFiles は名前で飛ばさない。渡したちょうどのパスだけを歩かない(同じ名前の深い場所は歩く)', () => {
    const root = tree(['a.txt', '.well-known/x.txt', 'build/b.txt', 'coverage/c.txt', 'dist/d.txt', '.next/n.txt', 'node_modules/p/e.txt', 'z/build/f.txt', 'z/node_modules/g.txt']);

    expect(relatives(root, walkFiles(root, () => true))).toEqual(['.next/n.txt', '.well-known/x.txt', 'a.txt', 'build/b.txt', 'coverage/c.txt', 'dist/d.txt', 'node_modules/p/e.txt', 'z/build/f.txt', 'z/node_modules/g.txt']);
    expect(relatives(root, walkFiles(root, () => true, ['build', 'node_modules']))).toEqual(['.next/n.txt', '.well-known/x.txt', 'a.txt', 'coverage/c.txt', 'dist/d.txt', 'z/build/f.txt', 'z/node_modules/g.txt']);
  });

  it('出力の閉じた表は、走査の根からのちょうどのパスに写る', () => {
    expect(outputPathsUnder('framework/runtime', null)).toEqual(['node_modules', 'dist', 'coverage']);
    expect(outputPathsUnder('product-app/src', 'product-app')).toEqual([]);
    expect(outputPathsUnder('product-app', 'product-app')).toEqual(expect.arrayContaining(['node_modules', '.next', 'build']));
    expect(outputPathsUnder('product-app', null)).toEqual([]);
    expect(outputPathsUnder('framework', null)).toEqual(FRAMEWORK_OUTPUT_PATHS.filter((row) => row.startsWith('framework/')).map((row) => row.slice('framework/'.length)));
  });

  it('名前に改行などの制御文字を持つファイル・ディレクトリは読まない(名前は生成物のヘッダや報告の行に写るため)', () => {
    const root = tree(['ok/a.md', 'bad\nname/b.md', 'ok/c\r.md', 'ok/d\u2028.md']);

    expect(relatives(root, walkFiles(root, () => true))).toEqual(['ok/a.md']);
  });

  it('存在しない根(ENOENT)は、読めなかったとは数えない(歩く相手がいない。完全な走査の空)', () => {
    expect(walkTree(path.join(tmpdir(), 'walk-tree-ghost-never-created'))).toEqual({ files: [], unreadable: [] });
  });

  it('完全に歩けた木は unreadable が空(真の空の木も同じ)', () => {
    const root = tree(['a.txt']);
    const empty = mkdtempSync(path.join(tmpdir(), 'walk-tree-'));
    made.push(empty);

    expect(walkTree(root).unreadable).toEqual([]);
    expect(walkTree(empty)).toEqual({ files: [], unreadable: [] });
  });
});

describe('walkTree(読めなかった場所を、完全な走査の「0 件」にしない)', () => {
  /** 偽のファイルシステム(木の定義: ディレクトリ → 中の名前。名前が木のキーなら下がディレクトリ)。実の権限は変えない。 */
  function fakeFs(dirs: Readonly<Record<string, readonly string[]>>, failures: Readonly<Record<string, string>> = {}): WalkFs {
    const fail = (target: string): void => {
      const code = failures[target];
      if (code !== undefined) throw Object.assign(new Error(`${code}: ${target}`), { code });
    };
    return {
      list: (dir) => {
        fail(dir);
        const names = dirs[dir];
        if (names === undefined) throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' });
        return [...names];
      },
      isDirectory: (target) => {
        fail(target);
        return dirs[target] !== undefined;
      },
    };
  }

  const tree = { '/r': ['a.txt', 'sub', 'locked'], '/r/sub': ['b.txt'], '/r/locked': ['c.txt'] };

  it('走査の根が読めない(EACCES)なら unreadable に根を挙げる(files の空と区別できる)', () => {
    expect(walkTree('/r', fakeFs(tree, { '/r': 'EACCES' }))).toEqual({ files: [], unreadable: ['/r'] });
  });

  it('子のディレクトリが読めない(EACCES)なら、それを挙げ、読めた分は返す', () => {
    expect(walkTree('/r', fakeFs(tree, { '/r/locked': 'EACCES' }))).toEqual({ files: ['/r/a.txt', '/r/sub/b.txt'], unreadable: ['/r/locked'] });
  });

  it('名前を調べられない(stat の EACCES)ときも、それを挙げて続ける。調べる間に消えた(ENOENT)名前は数えない', () => {
    const result = walkTree('/r', fakeFs(tree, { '/r/a.txt': 'EACCES', '/r/sub': 'ENOENT' }));

    expect(result).toEqual({ files: ['/r/locked/c.txt'], unreadable: ['/r/a.txt'] });
  });

  it('子のディレクトリの中の読めない場所も、親へ積み上がる', () => {
    const nested = { '/r': ['d'], '/r/d': ['e'], '/r/d/e': ['f.txt'] };

    expect(walkTree('/r', fakeFs(nested, { '/r/d/e': 'EIO' }))).toEqual({ files: [], unreadable: ['/r/d/e'] });
  });

  it('コードの無い失敗(例外が Error でない)も読めなかったと数える', () => {
    const odd: WalkFs = { list: () => { throw 'boom'; }, isDirectory: () => false };

    expect(walkTree('/r', odd)).toEqual({ files: [], unreadable: ['/r'] });
  });
});
