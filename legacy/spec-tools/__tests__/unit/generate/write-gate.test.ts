/**
 * 書き込みの関所(`lib/generate/write-gate.ts`)と、それを通す `applyGeneratedSections` の単体テスト。
 *
 * 敵対的な仕様は生成物の書き先(migration の名前など)を宣言できる。リポジトリがコミットしたシンボリックリンクは、
 * 書き込みを木の外へ辿らせる。どちらも「書かずに理由を返す」ことを、実ファイルシステム(使い捨ての置き場)で確かめる。
 */

import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGeneratedSections } from '../../../lib/generate/apply-sections.js';
import type { FileSection } from '../../../lib/generate/apply-sections.js';
import { relativePathProblem, writableTreesOf, writeGuarded, writeRefusalsOf, writeTargetProblem } from '../../../lib/generate/write-gate.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'write-gate-root-'));
  outside = mkdtempSync(join(tmpdir(), 'write-gate-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const TREES = ['db/mig', 'pub/out', 'app'];

/** 全文書き換えの 1 ファイル。 */
function whole(content: string): readonly FileSection[] {
  return [{ content, wholeFile: true }];
}

describe('relativePathProblem(綴りだけの検査)', () => {
  it.each([
    ['../../../.zshrc', '".." を含みます'],
    ['db/mig/../../../escape.sql', '".." を含みます'],
    ['/etc/passwd', '絶対パスです'],
    ['C:/Windows/x.sql', '絶対パスです'],
    ['db\\mig\\x.sql', '制御文字またはバックスラッシュ'],
    ['db/mig/a\nb.sql', '制御文字またはバックスラッシュ'],
    ['db/mig/a\u0000.sql', '制御文字またはバックスラッシュ'],
    ['db//mig/x.sql', '空の要素'],
    ['./supabase/x.sql', '空の要素'],
    ['.git/hooks/pre-commit', '.git の中へは書けません'],
    ['pub/.github/workflows/x.yml', '.github の中へは書けません'],
    ['', '空のパスです'],
    ['pub/a\u200Cb', '制御文字'],
    ['pub/a\u200Bb', '制御文字'],
    ['pub/a\u202Eb', '制御文字'],
    ['pub/.GIT/hooks/x', 'で始まる名前'],
    ['pub/.Github/workflows/x.yml', 'で始まる名前'],
    ['pub/.gitignore', 'で始まる名前'],
    ['pub/.gitmodules', 'で始まる名前'],
    ['pub/GIT~1/config', 'で始まる名前'],
    ['pub/name.', '末尾が'],
    ['pub/name ', '末尾が'],
    ['pub/a:stream', '":" を含みます'],
  ])('%j は拒む', (file, reason) => {
    expect(relativePathProblem(file)).toContain(reason);
  });

  it('通常の相対パスは通す', () => {
    expect(relativePathProblem('db/mig/20260101000000_ddl_rooms.sql')).toBeNull();
  });
});

describe('writeTargetProblem(木・リンク・種類)', () => {
  it('宣言した木の外は拒む(綴りが正しくても)', () => {
    expect(writeTargetProblem(root, 'other/x.sql', TREES)).toContain('木の外');
  });

  it('木の下の新規ファイルは通す', () => {
    expect(writeTargetProblem(root, 'db/mig/20260101000000_a.sql', TREES)).toBeNull();
  });

  it('途中のディレクトリがシンボリックリンクなら拒む(リンク先が木の外でも中でも)', () => {
    mkdirSync(join(root, 'pub'), { recursive: true });
    symlinkSync(outside, join(root, 'pub/out'));
    expect(writeTargetProblem(root, 'pub/out/README.md', TREES)).toContain('シンボリックリンク');
  });

  it('ファイル自身がシンボリックリンクなら拒む(宙ぶらりんでも)', () => {
    mkdirSync(join(root, 'pub/out'), { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'secret');
    symlinkSync(join(outside, 'victim.txt'), join(root, 'pub/out/README.md'));
    symlinkSync(join(outside, 'missing.txt'), join(root, 'pub/out/dangling.md'));
    expect(writeTargetProblem(root, 'pub/out/README.md', TREES)).toContain('シンボリックリンク');
    expect(writeTargetProblem(root, 'pub/out/dangling.md', TREES)).toContain('シンボリックリンク');
  });

  it('書き先がディレクトリなら拒む', () => {
    mkdirSync(join(root, 'pub/out/chapter.md'), { recursive: true });
    expect(writeTargetProblem(root, 'pub/out/chapter.md', TREES)).toContain('通常のファイルではありません');
  });
});

describe('writableTreesOf', () => {
  it('製品が宣言した根だけ(持たない根は出ない)。仕組みの台帳は仕組みの木のときだけ 1 ファイル足す', () => {
    const own = writableTreesOf(TEST_ROOTS, { ownFrameworkTree: true });
    const other = writableTreesOf(TEST_ROOTS, { ownFrameworkTree: false });

    expect(other).toContain(TEST_ROOTS.specs);
    expect(other).toContain(TEST_ROOTS.migrations);
    expect(other.some((tree) => tree.startsWith('framework'))).toBe(false);
    expect(own.filter((tree) => !other.includes(tree))).toEqual(['framework/guarantees.md']);
  });
});

describe('applyGeneratedSections は関所を通る', () => {
  it('migration の名前に ../ を書いた仕様: 何も書かず、木の外にもファイルを作らない', () => {
    const byFile = new Map<string, readonly FileSection[]>([
      ['db/mig/20260101000000_ok.sql', whole('select 1;')],
      ['db/mig/../../../../escape_marker.sql', whole('-- escaped')],
    ]);

    const result = applyGeneratedSections(byFile, root, { check: false, trees: TREES });

    expect(result.refused.map((entry) => entry.file)).toEqual(['db/mig/../../../../escape_marker.sql']);
    expect(result.written).toEqual([]);
    expect(existsSync(join(root, 'db/mig/20260101000000_ok.sql'))).toBe(false);
    expect(existsSync(join(root, '../escape_marker.sql'))).toBe(false);
  });

  it('コミットされたシンボリックリンク(ディレクトリ)を辿って外へ書かない', () => {
    mkdirSync(join(root, 'pub'), { recursive: true });
    symlinkSync(outside, join(root, 'pub/out'));
    const byFile = new Map<string, readonly FileSection[]>([['pub/out/README.md', whole('generated')]]);

    const result = applyGeneratedSections(byFile, root, { check: false, trees: TREES });

    expect(result.refused).toHaveLength(1);
    expect(existsSync(join(outside, 'README.md'))).toBe(false);
  });

  it('コミットされたシンボリックリンク(ファイル)の先を上書きしない・読みもしない(check でも同じ)', () => {
    mkdirSync(join(root, 'pub/out'), { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'precious');
    symlinkSync(join(outside, 'victim.txt'), join(root, 'pub/out/README.md'));
    const byFile = new Map<string, readonly FileSection[]>([['pub/out/README.md', whole('generated')]]);

    const written = applyGeneratedSections(byFile, root, { check: false, trees: TREES });
    const checked = applyGeneratedSections(byFile, root, { check: true, trees: TREES });

    expect(written.refused).toHaveLength(1);
    expect(checked.refused).toHaveLength(1);
    expect(checked.stale).toEqual([]);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf-8')).toBe('precious');
  });

  it('報告に出す書き先の制御文字は ? になる(報告の行を壊さない)', () => {
    const byFile = new Map<string, readonly FileSection[]>([['db/mig/a\nb.sql', whole('x')]]);

    const refusals = writeRefusalsOf(root, byFile.keys(), TREES);

    expect(refusals[0]?.file).toBe('db/mig/a?b.sql');
  });

  it('関所を通る正常な書き込みは今までどおり', () => {
    const byFile = new Map<string, readonly FileSection[]>([['db/mig/20260101000000_ok.sql', whole('select 1;')]]);

    const result = applyGeneratedSections(byFile, root, { check: false, trees: TREES });

    expect(result.refused).toEqual([]);
    expect(readFileSync(join(root, 'db/mig/20260101000000_ok.sql'), 'utf-8')).toBe('select 1;');
  });
});

describe('writeGuarded(検査のあとの差し替えに耐える書き方)', () => {
  it('通常のファイルには書ける(新規でも既存でも切り詰めて書く)', () => {
    const target = join(root, 'a.txt');
    writeFileSync(target, 'old content that is long');

    expect(writeGuarded(target, 'new')).toBeNull();
    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(writeGuarded(join(root, 'b.txt'), 'fresh')).toBeNull();
  });

  it('シンボリックリンクは辿らず、先を書き換えない', () => {
    writeFileSync(join(outside, 'victim.txt'), 'precious');
    symlinkSync(join(outside, 'victim.txt'), join(root, 'link.txt'));

    expect(writeGuarded(join(root, 'link.txt'), 'evil')).not.toBeNull();
    expect(readFileSync(join(outside, 'victim.txt'), 'utf-8')).toBe('precious');
  });

  it('ハードリンクを持つファイルは、別名の先を書き換えないよう拒む(切り詰めもしない)', () => {
    writeFileSync(join(outside, 'victim.txt'), 'precious');
    linkSync(join(outside, 'victim.txt'), join(root, 'hard.txt'));

    expect(writeGuarded(join(root, 'hard.txt'), 'evil')).not.toBeNull();
    expect(readFileSync(join(outside, 'victim.txt'), 'utf-8')).toBe('precious');
  });

  it('関所の検査もハードリンクを持つ書き先を拒む', () => {
    mkdirSync(join(root, 'pub'), { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'precious');
    linkSync(join(outside, 'victim.txt'), join(root, 'pub/hard.md'));

    expect(writeTargetProblem(root, 'pub/hard.md', ['pub'])).toContain('ハードリンク');
  });
});
