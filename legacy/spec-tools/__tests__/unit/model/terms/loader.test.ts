/**
 * 用語の台帳のローダー(I/O 境界)のテスト。
 *
 * 台帳が無い環境で壊れないこと・読めた台帳がモデルになること・壊れた台帳が M11 の error になること。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTermLedgerModel } from '../../../../lib/model/terms/loader.js';

const VALID = [
  '---',
  'doc_type: term_ledger',
  'scope: common',
  'id: term-ledger',
  'terms:',
  '  - term: fixture',
  '    id: fixture',
  '    gloss: テストが使う固定の入力',
  '    origin: english',
  '    first: docs/rules/a.md',
  '    face: framework',
  '    avoid: [固定物]',
  '---',
  '',
  '# 用語の台帳',
  '',
].join('\n');

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'terms-loader-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 台帳ファイルを書いて読む。 */
function load(source: string) {
  const file = path.join(root, 'terms.md');
  writeFileSync(file, source);
  return loadTermLedgerModel(file, { repoRoot: root });
}

describe('loadTermLedgerModel', () => {
  it('ファイルが無ければ available: false の空モデル(台帳を開設していない製品でも壊れない)', () => {
    const result = loadTermLedgerModel(path.join(root, 'terms.md'), { repoRoot: root });

    expect(result).toEqual({ model: { available: false, ledger: null }, findings: [] });
  });

  it('正しい台帳を読んで、語を宣言順に持つ', () => {
    const { model, findings } = load(VALID);

    expect(findings).toEqual([]);
    expect(model.available).toBe(true);
    expect(model.ledger?.terms.map((decl) => decl.term)).toEqual(['fixture']);
    expect(model.ledger?.terms[0]?.location.file).toBe('terms.md');
  });

  it('スキーマ違反は M11 の error になる(検証器 ID が付け替わる)', () => {
    const { model, findings } = load(VALID.replace('origin: english', 'origin: invented'));

    expect(model.available).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verifier === 'M11' && finding.severity === 'error')).toBe(true);
  });

  it('フロントマターが無ければ ledger は null で M11 の error', () => {
    const { model, findings } = load('# 台帳だけ\n');

    expect(model).toEqual({ available: true, ledger: null });
    expect(findings.map((finding) => finding.verifier)).toEqual(['M11']);
  });
});
