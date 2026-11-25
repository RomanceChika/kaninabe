/**
 * lib/docs/run(M 群の実行口)のテスト。
 * 対象の要求: ローダー + M1〜M6 を通しで動かし、健全なツリーでは無言、
 * 壊れたツリーでは各チェックが 1 件以上出ること。docs/rules・docs/specs が無い環境で壊れないこと。
 *
 * docs/specs まで走査を広げた分(仕様のフロントマター破損・仕様のリンク切れ・
 * rules ⇔ specs をまたぐ id 重複)もここで固定する。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDocsVerification } from '../../../lib/docs/run.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');

/** fixture の docs ルートに対して M 群を通しで実行する。 */
function run(name: string) {
  const docsRoot = path.join(FIXTURES, name);
  return runDocsVerification({ roots: TEST_ROOTS,
    rulesRoot: path.join(docsRoot, 'rules'),
    specsRoot: path.join(docsRoot, 'specs'),
    docsRoot,
    repoRoot: FIXTURES,
  });
}

/** 実行結果から、検証器 ID とファイル名の末尾で Finding を絞る。 */
function findingsFor(name: string, verifier: string, suffix: string) {
  return run(name).findings.filter(
    (finding) => finding.verifier === verifier && finding.location.file.endsWith(suffix),
  );
}

describe('runDocsVerification', () => {
  it('健全なツリーでは違反が 1 件も出ない', () => {
    const result = run('docs-tree-valid');

    expect(result.available).toBe(true);
    expect(result.docCount).toBe(14);
    expect(result.specsDocCount).toBe(6);
    expect(result.linkedFileCount).toBe(14);
    expect(result.findings).toEqual([]);
  });

  it('壊れたツリーでは M1〜M6 のすべてが違反を検出する', () => {
    const result = run('docs-tree-invalid');
    const byVerifier = new Map<string, number>();
    for (const finding of result.findings) {
      byVerifier.set(finding.verifier, (byVerifier.get(finding.verifier) ?? 0) + 1);
    }

    expect(result.available).toBe(true);
    expect([...byVerifier.keys()].sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
  });

  it('壊れたツリーの違反は「どこで・どう直すか」を必ず持つ', () => {
    for (const finding of run('docs-tree-invalid').findings) {
      expect(finding.location.file).not.toBe('');
      expect(finding.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('境界: docs/rules も docs/specs も無い環境ではスキップし、違反も出さない', () => {
    const result = runDocsVerification({ roots: TEST_ROOTS,
      rulesRoot: path.join(FIXTURES, 'docs-tree-valid', 'no-such-dir'),
      specsRoot: path.join(FIXTURES, 'docs-tree-valid', 'no-such-dir-either'),
      docsRoot: path.join(FIXTURES, 'docs-tree-valid'),
      repoRoot: FIXTURES,
    });

    expect(result).toEqual({
      findings: [],
      available: false,
      docCount: 0,
      specsDocCount: 0,
      knowledgeDocCount: 0,
      linkedFileCount: 0,
    });
  });

  it('境界: docs/specs のディレクトリごと無い構成は M0 で警告しない(仕様だけ / 規約だけの木は正当)', () => {
    const result = runDocsVerification({ roots: TEST_ROOTS,
      rulesRoot: path.join(FIXTURES, 'docs-tree-valid', 'rules'),
      specsRoot: path.join(FIXTURES, 'docs-tree-valid', 'no-such-dir'),
      docsRoot: path.join(FIXTURES, 'docs-tree-valid'),
      repoRoot: FIXTURES,
    });

    expect(result.available).toBe(true);
    expect(result.docCount).toBe(8);
    expect(result.specsDocCount).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('境界: ディレクトリはあるのに 0 件なら M0 で警告する(走査範囲が黙って狭まる事故)', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'docs-empty-specs-'));
    try {
      const result = runDocsVerification({ roots: TEST_ROOTS,
        rulesRoot: path.join(FIXTURES, 'docs-tree-valid', 'rules'),
        specsRoot: empty,
        docsRoot: path.join(FIXTURES, 'docs-tree-valid'),
        repoRoot: path.dirname(empty),
      });

      expect(result.available).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.verifier).toBe('M0');
      expect(result.findings[0]?.severity).toBe('warning');
      expect(result.findings[0]?.message).toContain('走査対象の文書が 1 件もありません');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('runDocsVerification docs/specs の走査', () => {
  /**
   * 実際に起きた事故の再現(NOTES「バックログ掃除完了」)。
   * specs/backend/actions/README.md がフロントマターを閉じないまま 155 バイトで切れてコミットされ、
   * M 群が docs/rules しか走査していなかったため verify は緑のままだった。
   */
  it('フロントマターが閉じないまま切れた仕様側の README を M1 で検出する', () => {
    const found = findingsFor('docs-tree-invalid', 'M1', 'specs/backend/actions/README.md');

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.message).toContain('フロントマター');
  });

  it('仕様文書の本文のリンク切れを M4 で検出する', () => {
    const found = findingsFor('docs-tree-invalid', 'M4', 'specs/backend/actions/entry/create.md');

    expect(found.map((finding) => finding.message)).toEqual([
      'リンク先が見つかりません: ./template.action_spec.md',
      'リンク先が見つかりません: ../../../domain/entry/states.md',
    ]);
  });

  it('フロントマターを持たない設計文書(台帳の外の docs/ の文書)のリンク切れも M4 で検出する', () => {
    const found = findingsFor('docs-tree-invalid', 'M4', 'design/notes.md');

    expect(found.map((finding) => finding.message)).toEqual(['リンク先が見つかりません: ./nowhere.md']);
  });

  it('根の文書(linkedRootFiles)のリンク切れも M4 で検出する。指定が無ければ読まない', () => {
    const docsRoot = path.join(FIXTURES, 'docs-tree-valid');
    const options = { roots: TEST_ROOTS, rulesRoot: path.join(docsRoot, 'rules'), specsRoot: path.join(docsRoot, 'specs'), docsRoot, repoRoot: path.join(FIXTURES, 'link-scan-tree') };
    const withRoot = runDocsVerification({ ...options, linkedRootFiles: ['CLAUDE.md'] }).findings.filter((f) => f.verifier === 'M4');
    const without = runDocsVerification(options).findings.filter((f) => f.verifier === 'M4');

    expect(withRoot.map((f) => f.location.file)).toContain('CLAUDE.md');
    expect(without.map((f) => f.location.file)).not.toContain('CLAUDE.md');
  });

  it('仕様文書の norms が実在しない id を指していれば M3 で検出する', () => {
    const found = findingsFor('docs-tree-invalid', 'M3', 'specs/backend/actions/entry/create.md');

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('ARCH-9999');
  });

  it('rules と specs をまたぐ id 重複を M2 で検出する', () => {
    const found = run('docs-tree-invalid').findings.filter(
      (finding) => finding.verifier === 'M2' && finding.counterexample?.['id'] === 'DG-0001',
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('error');
    // どちらのツリーが先に走査されたかに依存しないよう、宣言している文書をパス順で並べる。
    expect(found[0]?.counterexample?.['declared_in']).toBe(
      'docs-tree-invalid/rules/legacy/README.md, docs-tree-invalid/specs/domain/README.md',
    );
  });

  it('ドメイン仕様の id 欠落を M1 で検出する(V 群が文書の id を読まないため)', () => {
    const found = findingsFor('docs-tree-invalid', 'M1', 'specs/domain/entry/access.md');

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.counterexample).toMatchObject({ doc_type: 'access_spec', field: 'id' });
  });

  it('仕様の id 形式(workshop-states 等)から外れていれば M2 で検出する', () => {
    const found = findingsFor('docs-tree-invalid', 'M2', 'specs/domain/workshop/states.md');

    expect(found).toHaveLength(1);
    expect(found[0]?.counterexample?.['expected']).toBe('workshop-states');
  });

  it('仕様の doc_type を「doc_types.md 未定義」として警告せず、スキーマの中身も見ない', () => {
    const specsFindings = run('docs-tree-valid').findings.filter((finding) =>
      finding.location.file.includes('/specs/'),
    );

    expect(specsFindings).toEqual([]);
  });

  it('仕様文書にはテンプレート準拠(M5)を適用しない', () => {
    const found = findingsFor('docs-tree-valid', 'M5', 'specs/domain/workshop/states.md');

    expect(found).toEqual([]);
  });
});
