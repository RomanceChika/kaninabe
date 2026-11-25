/**
 * link-scan(リンクの実在を見る範囲と実在の判定。M4 の入力)のテスト。
 * 対象の要求: 範囲は CLAUDE.md と docs/ の下の全部の .md の閉じた集合(フロントマターの有無を問わない。
 * node_modules・.vitepress・テンプレート・html は読まない)で、相対リンクを実ファイルに照らすこと。
 * ファイル I/O を行う層なので fixtures(link-scan-tree)を使う(規約: scripts-code-quality.md)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanLinkedFiles } from '../../../../lib/model/docs/link-scan.js';

const TREE = path.resolve(import.meta.dirname, '../../../fixtures/link-scan-tree');

/** fixture を走査する(根の文書は CLAUDE.md)。 */
function scanTree(rootFiles: readonly string[] = ['CLAUDE.md']) {
  return scanLinkedFiles({ repoRoot: TREE, docsRoot: path.join(TREE, 'docs'), rootFiles });
}

/** 1 ファイルの (href → 実在) の対応。 */
function existence(file: string): Record<string, boolean> {
  const found = scanTree().linked.find((entry) => entry.file === file);
  if (found === undefined) throw new Error(`${file} が範囲に入っていません`);
  return Object.fromEntries(found.links.map((link) => [link.href, link.exists]));
}

describe('scanLinkedFiles 範囲(閉じた集合)', () => {
  it('CLAUDE.md と docs/ の下の .md を名前順に読む。テンプレート・.vitepress・html は読まない', () => {
    expect(scanTree().linked.map((entry) => entry.file)).toEqual([
      'CLAUDE.md',
      'docs/a.md',
      'docs/dir/README.md',
      'docs/nodir/c.md',
      'docs/sub/b.md',
      'docs/sub/with space.md',
    ]);
  });

  it('根の文書の指定が無ければ docs/ の下だけを読む', () => {
    expect(scanTree([]).linked.map((entry) => entry.file)).not.toContain('CLAUDE.md');
  });

  it('境界: 指定した根の文書が無い木でも壊れない(読まないだけ)', () => {
    expect(scanTree(['NO-SUCH.md']).findings).toEqual([]);
    expect(scanTree(['NO-SUCH.md']).linked.map((entry) => entry.file)).not.toContain('NO-SUCH.md');
  });

  it('フロントマターを持たない文書も読む', () => {
    expect(scanTree().linked.map((entry) => entry.file)).toContain('docs/a.md');
  });

  describe('node_modules は読まない(実行時に作る。git が追わない名前なので fixture に置けない)', () => {
    const made: string[] = [];
    afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

    it('docs/node_modules の下の .md は範囲に入らない', () => {
      const repo = mkdtempSync(path.join(tmpdir(), 'link-scan-'));
      made.push(repo);
      mkdirSync(path.join(repo, 'docs', 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(path.join(repo, 'docs', 'keep.md'), '[x](./nowhere.md)\n');
      writeFileSync(path.join(repo, 'docs', 'node_modules', 'pkg', 'readme.md'), '[x](./nowhere.md)\n');

      const files = scanLinkedFiles({ repoRoot: repo, docsRoot: path.join(repo, 'docs'), rootFiles: [] }).linked;

      expect(files.map((entry) => entry.file)).toEqual(['docs/keep.md']);
    });
  });
});

describe('scanLinkedFiles 実在の判定', () => {
  it('docs/a.md の各形のリンクが、実在・不在のとおりに判定される', () => {
    expect(existence('docs/a.md')).toEqual({
      './sub/b.md': true,
      './sub/b.md#節': true,
      './sub/gone.md#節': false,
      './sub/b.md?x=1': true,
      '/sub/b.md': true,
      '/sub/gone.md': false,
      './dir/': true,
      './nodir/': false,
      './sub/b': true,
      './sub/with%20space.md': true,
      './img/none.png': false,
      './sub/gone-by-ref.md': false,
    });
  });

  it('切れたリンクは行番号と解決先を持つ(参照の定義は定義の行)', () => {
    const file = scanTree().linked.find((entry) => entry.file === 'docs/a.md');

    expect(file?.links.find((link) => link.href === './sub/gone-by-ref.md')).toEqual({
      href: './sub/gone-by-ref.md',
      target: 'docs/sub/gone-by-ref.md',
      exists: false,
      line: 16,
    });
  });

  it('CLAUDE.md のリンクはリポジトリの根から解く。docs/ の外のディレクトリは中身が無くても実在', () => {
    expect(existence('CLAUDE.md')).toEqual({
      'docs/a.md': true,
      'docs/missing-from-root.md': false,
      'outside-dir/': true,
    });
  });

  it('負例: 外部・ページ内アンカー・コードの中のリンクは見ない(構文木で読む)', () => {
    const hrefs = Object.keys(existence('docs/a.md'));

    expect(hrefs.some((href) => href.startsWith('http') || href.startsWith('mailto') || href.startsWith('#'))).toBe(false);
    expect(hrefs).not.toContain('./in-fence.md');
    expect(hrefs).not.toContain('./in-inline.md');
  });
});
