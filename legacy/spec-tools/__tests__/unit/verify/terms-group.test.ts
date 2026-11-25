/**
 * 用語の台帳(M7〜M9)の配線のテスト。一時ツリーを製品として組み、verify の 1 群として通しで動かす。
 *
 * 台帳が無い・壊れている環境で壊れないこと、あれば規約・ブック・製品が宣言した木(`term_scan`)を見ること。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTerms } from '../../../lib/verify/terms-group.js';
import { NO_TERM_SCAN } from '../../../lib/model/product/types.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';

const LEDGER = [
  '---',
  'doc_type: term_ledger',
  'scope: common',
  'id: term-ledger',
  'terms:',
  '  - term: fixture',
  '    id: fixture',
  '    gloss: テストの固定入力',
  '    origin: english',
  '    first: docs/rules/a.md',
  '    face: framework',
  '    avoid: [固定物]',
  '---',
  '',
].join('\n');

let root = '';
let domainRoot = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'terms-group-'));
  writeProductDeclaration(root);
  domainRoot = path.join(root, TEST_ROOTS.specs, 'domain');
  mkdirSync(domainRoot, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 一時ツリーにファイルを書く。 */
function write(relative: string, source: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

/** 製品が宣言した追加の走査範囲(設計メモに当たる木を 1 本)。テスト用の仮の置き場で、このリポジトリの宣言には依らない。 */
const MEMO_TREE = 'memo-tree';

/** 配線を動かして (Finding, 報告の行) を返す。 */
function run() {
  const lines: string[] = [];
  const roots = { ...TEST_ROOTS, termScan: { ...NO_TERM_SCAN, proseTrees: [MEMO_TREE] } };
  const findings = runTerms(domainRoot, roots, (line) => lines.push(line));
  return { findings, lines };
}

describe('runTerms', () => {
  it('台帳が無ければスキップを報告して何も返さない', () => {
    const { findings, lines } = run();

    expect(findings).toEqual([]);
    expect(lines.join('\n')).toContain('スキップ');
  });

  it('壊れた行は M11 が名指しし、読めた行だけを M7〜M9 が見る(壊れた行について二重に言わない)', () => {
    write(`${TEST_ROOTS.specs}/terms.md`, LEDGER.replace('origin: english', 'origin: invented'));
    write('docs/rules/a.md', 'テストの固定物\n');

    const { findings, lines } = run();

    expect(findings.map((finding) => finding.verifier)).toEqual(['M11']);
    expect(lines.join('\n')).toContain('0 語');
  });

  it('フロントマターが読めない台帳は M11 だけを返し、M7〜M9 はスキップする', () => {
    write(`${TEST_ROOTS.specs}/terms.md`, '# 台帳だけ\n');

    const { findings, lines } = run();

    expect(findings.map((finding) => finding.verifier)).toEqual(['M11']);
    expect(lines.join('\n')).toContain('スキップ');
  });

  it('規約の木・製品が宣言した木・ブックの 3 つを見る(初出の実在・死んだ行・旧綴り)', () => {
    write(`${TEST_ROOTS.specs}/terms.md`, LEDGER);
    write('docs/rules/a.md', 'fixture を置く(固定入力のこと)<!-- term: fixture -->\n');
    write(`${MEMO_TREE}/b.md`, 'テストの固定物\n');
    write(`${TEST_ROOTS.book}/c.md`, '固定物がまた出る\n');

    const { findings, lines } = run();

    expect(findings.map((finding) => finding.verifier)).toEqual(['M9', 'M9']);
    expect(findings.map((finding) => finding.location.file).sort()).toEqual(
      [`${MEMO_TREE}/b.md`, `${TEST_ROOTS.book}/c.md`].sort(),
    );
    expect(lines.join('\n')).toContain('1 語');
  });

  it('規約・宣言した木・ブックが綴りの違反を持たなければ無言', () => {
    write(`${TEST_ROOTS.specs}/terms.md`, LEDGER);
    write('docs/rules/a.md', 'fixture を置く(固定入力のこと)<!-- term: fixture -->\n');

    expect(run().findings).toEqual([]);
  });
});
