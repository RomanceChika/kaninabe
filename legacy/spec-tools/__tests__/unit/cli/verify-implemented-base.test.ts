/**
 * `verify` の `--implemented-base <product.md>`(実装の範囲が広がる向きにしか動かないことの、base との比較)を、本物の CLI で別プロセスで見る。
 *
 * 比べるのは仕様の id である。head は題材 `rooms`(仕様だけの木。検査は 0 error で通る)に `implemented` を書いたもの、
 * base は CI が渡す「基準の側の product.md」。
 *   - 広がった(base の id が全部残り、足された)→ 通る(終了コード 0・P14 なし)
 *   - base の id が消え、その仕様がまだある → P14 で終了コード 1(消えた id を名指す)
 *   - base の id が消え、仕様も無い → 通る。件数を 1 行に数え、id は出さない
 *   - base の file が無い・読めない(ディレクトリ)・YAML が壊れている・`implemented` が壊れている → **error で終了コード 1。読み飛ばして緑にしない**
 *   - base にキーが無い → error にせず、base と実装の範囲を名指す 1 行だけ(終了コード 0)
 *   - `--implemented-base` を渡さなければ、P14 は何も言わない(base が無い実行は、いつもの verify)
 * 引数は `--implemented-base <file>` の空白区切りの形で渡す(位置引数の仕様の木のパスと取り違えない)。
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { cleanupTemps, cliPath, editFile, SLOW, temp } from '../../helpers/book-entry-fixture.js';
import { runToolCli, TOOL_TREE } from '../../helpers/run-tool-cli.js';

const ROOMS = path.join(import.meta.dirname, '../../fixtures/samples/rooms');

const scratch: string[] = [];

afterAll(() => {
  cleanupTemps();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** head の木(`implemented` の行を入れた rooms の写し)。 */
function headTree(label: string, ids: readonly string[]): string {
  const root = temp(label);
  cpSync(ROOMS, root, { recursive: true });
  const lines = ids.length === 0 ? 'implemented: []' : `implemented:\n${ids.map((id) => `  - ${id}`).join('\n')}`;
  editFile(root, PRODUCT_DECL_FILE, (text) => text.replace('  - usecases\n---', `  - usecases\n${lines}\n---`));
  return root;
}

/** base の product.md を木の外に書く(`frontmatterTail` は `uses` の後ろの行)。 */
function baseFile(frontmatterTail: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'implemented-base-'));
  scratch.push(dir);
  const file = path.join(dir, 'product.md');
  writeFileSync(file, ['---', 'doc_type: product_roots', 'scope: common', 'id: product-roots', 'name: sample-rooms', 'roots:', '  specs: docs/specs', '  book: docs/book', '  generated: app/src/domain/generated', '  migrations: supabase/migrations', 'uses:', '  - actions', ...frontmatterTail, '---', ''].join('\n'));
  return file;
}

/** verify を回す。 */
function verify(root: string, base: string | null): ReturnType<typeof runToolCli> {
  return runToolCli(cliPath('verify-docs.ts'), TOOL_TREE, ['--root', root, ...(base === null ? [] : ['--implemented-base', base])]);
}

const P14_ERROR = /error \[P14\]/u;

describe('verify --implemented-base', () => {
  let widened: string;

  beforeAll(() => {
    widened = headTree('base-head', ['room-create-action', 'room-delete-action']);
  });

  it('base を渡さなければ、P14 は何も言わない(対照: head だけで 0 error)', () => {
    const run = verify(widened, null);

    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).not.toMatch(P14_ERROR);
  }, SLOW);

  it('広がった(base の id が残り、足された): 通る', () => {
    const run = verify(widened, baseFile(['implemented:', '  - room-create-action']));

    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).not.toMatch(P14_ERROR);
  }, SLOW);

  it('変わらない: 通る', () => {
    const run = verify(widened, baseFile(['implemented:', '  - room-create-action', '  - room-delete-action']));

    expect(run.status, run.stdout).toBe(0);
  }, SLOW);

  it('base の id が消え、その仕様がまだある: P14 で終了コード 1(消えた id を名指す)', () => {
    const head = headTree('base-narrowed', ['room-create-action']);

    const run = verify(head, baseFile(['implemented:', '  - room-create-action', '  - room-delete-action']));

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(P14_ERROR);
    expect(run.stdout).toContain('base の実装の範囲にあった room-delete-action が範囲から消えています');
  }, SLOW);

  it('base の id が消え、仕様も無い(廃止・改名): 通る。件数を 1 行に数え、id は出さない', () => {
    const run = verify(headTree('base-retired', ['room-create-action']), baseFile(['implemented:', '  - room-create-action', '  - room-retired-action']));

    expect(run.status, run.stdout).toBe(0);
    // 件数は P14 の注記の行そのもので見る(検証結果の要約の行にも `N 件` が出るので、全体に対する `toContain` は何も見ない)。
    const noteLines = run.stdout.split('\n').filter((line) => line.includes('base') && line.includes('実装の範囲'));
    expect(noteLines).toHaveLength(1);
    expect(noteLines[0]).toContain('1 件');
    expect(noteLines[0]).not.toContain('room-retired-action');
    expect(run.stdout).not.toContain('room-retired-action');
  }, SLOW);

  it('--implemented-base を 2 回書けば、検証を始めずに終了コード 1 と固定の文言で止まる', () => {
    const file = baseFile(['implemented:', '  - room-create-action']);
    const run = runToolCli(cliPath('verify-docs.ts'), TOOL_TREE, ['--root', widened, '--implemented-base', file, '--implemented-base', file]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--implemented-base は 1 回だけ書いてください');
    expect(run.stdout).not.toContain('検証結果');
  }, SLOW);

  it('--implemented-base の値が無ければ、終了コード 1 と固定の文言で止まる', () => {
    const run = runToolCli(cliPath('verify-docs.ts'), TOOL_TREE, ['--root', widened, '--implemented-base']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--implemented-base には基準の product.md のパスを続けて書いてください');
  }, SLOW);

  it.each([
    ['file が無い', () => path.join(tmpdir(), 'implemented-base-no-such-dir', 'product.md')],
    ['読めない(ディレクトリ)', () => mkdtempSync(path.join(tmpdir(), 'implemented-base-dir-'))],
    ['YAML が壊れている', () => {
      const file = baseFile([]);
      writeFileSync(file, '---\nroots: [unclosed\n---\n');
      return file;
    }],
    ['frontmatter が無い', () => {
      const file = baseFile([]);
      writeFileSync(file, '# 宣言なし\n');
      return file;
    }],
    ['implemented の値が無い(null)', () => baseFile(['implemented:'])],
    ['implemented がリストでない', () => baseFile(['implemented: room-create-action'])],
    ['implemented に重複がある', () => baseFile(['implemented:', '  - room-create-action', '  - room-create-action'])],
  ])('base が%s: P14 の error で終了コード 1(読み飛ばして緑にしない)', (_label, make) => {
    const base = make();
    scratch.push(base);

    const run = verify(widened, base);

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(P14_ERROR);
  }, SLOW);

  it('base にキーが無い: error にせず、base と実装の範囲を名指す 1 行だけ言う(終了コード 0)', () => {
    const run = verify(widened, baseFile([]));
    const lines = run.stdout.split('\n').filter((line) => line.includes('base') && line.includes('実装の範囲'));

    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).not.toMatch(P14_ERROR);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('room-create-action');
  }, SLOW);
});

