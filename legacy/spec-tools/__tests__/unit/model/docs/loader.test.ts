/**
 * lib/model/docs/loader(docs/rules・docs/specs の走査)のテスト。
 * 対象の要求: テンプレートの解決(template_policy)・
 * フロントマターが取り出せない場合の M1 報告。
 *
 * ローダーはファイル I/O を行う層なので、ここだけは fixtures を使う
 * (規約: scripts-code-quality.md)。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocs } from '../../../../lib/model/docs/loader.js';
import type { ScannedDoc } from '../../../../lib/model/docs/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');

/** fixture の docs ルートから、走査ルート(既定は rules)を読み込む。 */
function load(name: string, root = 'rules'): readonly ScannedDoc[] {
  const docsRoot = path.join(FIXTURES, name);
  const result = loadDocs(path.join(docsRoot, root), { roots: TEST_ROOTS, docsRoot, repoRoot: FIXTURES });
  return result.model?.docs ?? [];
}

/** ファイル名末尾で 1 文書を引く。 */
function pick(docs: readonly ScannedDoc[], suffix: string): ScannedDoc {
  const found = docs.find((doc) => doc.file.endsWith(suffix));
  if (found === undefined) throw new Error(`fixture に ${suffix} がありません`);
  return found;
}

describe('loadDocs 走査の対象', () => {
  it('template.md と template.{doc_type}.md は文書として読まない', () => {
    const files = load('docs-tree-valid').map((doc) => doc.file);

    expect(files.some((file) => file.includes('template'))).toBe(false);
    expect(files).toHaveLength(8);
  });

  it('docs/specs も同じ読み方で走査でき、仕様の doc_type と id をモデルに載せる', () => {
    const docs = load('docs-tree-valid', 'specs');
    const doc = pick(docs, 'specs/backend/queries/workshop/workshop_list.md');

    expect(docs.map((d) => d.file)).toContain('docs-tree-valid/specs/domain/roles.md');
    expect(docs.some((d) => d.file.includes('template.state_spec.md'))).toBe(false);
    expect(doc.docType).toBe('query_spec');
    expect(doc.id).toBe('query-workshop-list');
  });

  it('走査ルートが無ければモデルは null(呼び出し側がスキップを判断する)', () => {
    const result = loadDocs(path.join(FIXTURES, 'docs-tree-valid', 'no-such-dir'), { roots: TEST_ROOTS });

    expect(result.model).toBeNull();
    expect(result.findings).toEqual([]);
  });
});

describe('loadDocs フロントマター', () => {
  it('doc_type と id をモデルに載せる', () => {
    const doc = pick(load('docs-tree-valid'), 'principles/PRIN-0001-example.md');

    expect(doc.docType).toBe('principle');
    expect(doc.id).toBe('PRIN-0001');
    expect(doc.frontmatter['scope']).toBe('common');
  });

  it('フロントマターが無い / 壊れている文書は M1 として報告し、モデルに載せない', () => {
    const docsRoot = path.join(FIXTURES, 'docs-tree-invalid');
    const result = loadDocs(path.join(docsRoot, 'rules'), { roots: TEST_ROOTS, docsRoot, repoRoot: FIXTURES });
    const files = (result.model?.docs ?? []).map((doc) => doc.file);

    expect(files.some((file) => file.endsWith('no-frontmatter.md'))).toBe(false);
    expect(files.some((file) => file.endsWith('broken-yaml.md'))).toBe(false);
    expect(result.findings.map((f) => f.verifier)).toEqual(['M1', 'M1']);
  });

  /**
   * 実際に起きた事故の再現。specs/backend/actions/README.md が
   * フロントマターを閉じないまま 155 バイトで切れた状態でコミットされ、
   * M 群が docs/rules しか走査していなかったため誰も気づかなかった(NOTES「バックログ掃除完了」)。
   */
  it('フロントマターが閉じないまま切れた仕様側の README を M1 として報告する', () => {
    const docsRoot = path.join(FIXTURES, 'docs-tree-invalid');
    const result = loadDocs(path.join(docsRoot, 'specs'), { roots: TEST_ROOTS, docsRoot, repoRoot: FIXTURES });
    const finding = result.findings.find((f) =>
      f.location.file.endsWith('specs/backend/actions/README.md'),
    );

    expect(finding?.verifier).toBe('M1');
    expect(finding?.severity).toBe('error');
    expect((result.model?.docs ?? []).map((doc) => doc.file)).not.toContain(
      'docs-tree-invalid/specs/backend/actions/README.md',
    );
  });
});

describe('loadDocs テンプレートの解決(template_policy)', () => {
  it('同階層の template.{doc_type}.md を優先する', () => {
    const doc = pick(load('docs-tree-valid'), 'principles/PRIN-0001-example.md');

    expect(doc.template?.file).toBe('docs-tree-valid/rules/principles/template.principle.md');
    expect(doc.template?.h2.map((h) => h.name)).toEqual(['原則', '背景']);
  });

  it('同階層に無ければ上の階層の template.md を使う', () => {
    const doc = pick(load('docs-tree-valid'), 'process/guide.md');

    expect(doc.template?.file).toBe('docs-tree-valid/rules/template.md');
  });

  it('(任意) が付いた見出しは省略可として読む', () => {
    const doc = pick(load('docs-tree-valid'), 'process/guide.md');

    expect(doc.template?.h2).toEqual([
      { name: '目的', optional: false },
      { name: '手順', optional: false },
      { name: '関連ドキュメント', optional: true },
    ]);
  });

  it('h2_policy: open を「H2 の語彙が開いている」として読む', () => {
    const doc = pick(load('docs-tree-valid'), 'open-guide/README.md');

    expect(doc.template?.file).toBe(
      'docs-tree-valid/rules/open-guide/template.directory_guide.md',
    );
    expect(doc.template?.openH2).toBe(true);
  });

  it('h2_policy を書かないテンプレートの語彙は閉じている', () => {
    const doc = pick(load('docs-tree-valid'), 'process/guide.md');

    expect(doc.template?.openH2).toBe(false);
  });

  it('doc_type が食い違う template.md は採用せず、上に探索を続ける', () => {
    const doc = pick(load('docs-tree-valid'), 'process/README.md');

    expect(doc.docType).toBe('directory_guide');
    expect(doc.template).toBeNull();
  });

  it('境界: docs ルートまで遡っても見つからなければ null(M5 の対象外)', () => {
    const doc = pick(load('docs-tree-invalid'), 'rules/bad-id.md');

    expect(doc.template).toBeNull();
  });
});
