/**
 * M3(参照実在)の規約網羅テスト。
 * 対象の要求: reference_policy.md「参照は id で書く」— norms / decisions の参照先が実在すること。
 */

import { describe, expect, it } from 'vitest';
import { referenceExistenceVerifier } from '../../../../lib/docs/verifiers/m3-reference-existence.js';
import { scannedDoc } from '../../../helpers/docs-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import type { DocsModel, ScannedDoc } from '../../../../lib/model/docs/types.js';

/**
 * 文書の並びから検査の入力を組む。**ドメイン知識の根(`knowledge`)はこのテストが自分で宣言する** ——
 * 規範逆流検査は「知識の層」の文書の置き場を製品の宣言から決めるので、`knowledge` を持たない製品でも
 * 知識の層の逆流を同じに見張れることを、宣言した根で確かめる(製品の宣言に寄りかからない)。
 */
function docsModel(docs: readonly ScannedDoc[]): DocsModel {
  return { docs, linked: [], roots: { ...TEST_ROOTS, knowledge: 'docs/knowledge' } };
}

describe('M3 参照実在', () => {
  it('norms / decisions の参照先がすべて実在すれば通る', () => {
    const model = docsModel([
      scannedDoc({ file: 'prin.md', docType: 'principle', id: 'PRIN-0001' }),
      scannedDoc({ file: 'adr.md', docType: 'decision', id: 'ADR-0001' }),
      scannedDoc({
        file: 'proc.md',
        frontmatter: { norms: ['PRIN-0001'], decisions: ['ADR-0001'] },
      }),
    ]);

    expect(referenceExistenceVerifier.verify(model)).toEqual([]);
  });

  it('実在しない norms 参照を検出する', () => {
    const model = docsModel([scannedDoc({ file: 'proc.md', frontmatter: { norms: ['PRIN-9999'] } })]);

    const findings = referenceExistenceVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location.pointer).toBe('norms.PRIN-9999');
    expect(findings[0]?.counterexample).toEqual({ key: 'norms', id: 'PRIN-9999' });
  });

  it('実在しない decisions 参照も検出する', () => {
    const model = docsModel([scannedDoc({ file: 'proc.md', frontmatter: { decisions: ['ADR-9999'] } })]);

    expect(referenceExistenceVerifier.verify(model).map((f) => f.counterexample?.['key'])).toEqual([
      'decisions',
    ]);
  });

  it('境界: 空配列は「参照が無い」ので違反にならない', () => {
    const model = docsModel([scannedDoc({ file: 'proc.md', frontmatter: { norms: [], decisions: [] } })]);

    expect(referenceExistenceVerifier.verify(model)).toEqual([]);
  });

  it('境界: 配列でない norms・文字列でない要素は無視する(形式は M1 の担当)', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', frontmatter: { norms: 'PRIN-0001' } }),
      scannedDoc({ file: 'b.md', frontmatter: { norms: [{ id: 'PRIN-0001' }, 42] } }),
    ]);

    expect(referenceExistenceVerifier.verify(model)).toEqual([]);
  });

  it('自分自身の id を参照していても実在は満たす(循環は M6 の担当)', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'architecture', id: 'ARCH-0001', frontmatter: { norms: ['ARCH-0001'] } }),
    ]);

    expect(referenceExistenceVerifier.verify(model)).toEqual([]);
  });

  describe('規範逆流検査(参照の向き)', () => {
    it('architecture が spec を norms で参照すると検出する(不可)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/specs/domain/foo/entity.md', docType: 'entity_spec', id: 'entity-foo' }),
        scannedDoc({
          file: 'docs/rules/architecture/system/backend/ARCH-BE-0099-x.md',
          docType: 'architecture',
          id: 'ARCH-BE-0099',
          frontmatter: { norms: ['entity-foo'] },
        }),
      ]);

      const findings = referenceExistenceVerifier.verify(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.counterexample).toEqual({ key: 'norms', id: 'entity-foo' });
      expect(findings[0]?.message).toContain('逆流');
    });

    it('meta が process を decisions で参照すると検出する(不可)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/rules/process/backend/system/standards/x.md', docType: 'process', id: 'PROC-X' }),
        scannedDoc({
          file: 'docs/rules/meta/standards/y.md',
          docType: 'meta',
          frontmatter: { decisions: ['PROC-X'] },
        }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toHaveLength(1);
    });

    it('domain が process を参照すると検出する(不可)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/rules/process/backend/x.md', docType: 'process', id: 'PROC-X' }),
        scannedDoc({
          file: 'docs/knowledge/TERM-foo.md',
          docType: 'domain_glossary',
          id: 'TERM-foo',
          frontmatter: { norms: ['PROC-X'] },
        }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toHaveLength(1);
    });

    it('process が spec を参照しても許容する(可)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/specs/domain/foo/entity.md', docType: 'entity_spec', id: 'entity-foo' }),
        scannedDoc({
          file: 'docs/rules/process/backend/x.md',
          docType: 'process',
          frontmatter: { norms: ['entity-foo'] },
        }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toEqual([]);
    });

    it('decision が spec を参照しても許容する(推奨)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/specs/domain/foo/entity.md', docType: 'entity_spec', id: 'entity-foo' }),
        scannedDoc({
          file: 'docs/rules/decisions/common/ADR-0099-x.md',
          docType: 'decision',
          id: 'ADR-0099',
          frontmatter: { decisions: ['entity-foo'] },
        }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toEqual([]);
    });

    it('domain が spec を参照しても許容する(可)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/specs/domain/foo/entity.md', docType: 'entity_spec', id: 'entity-foo' }),
        scannedDoc({
          file: 'docs/knowledge/TERM-foo.md',
          docType: 'domain_glossary',
          frontmatter: { norms: ['entity-foo'] },
        }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toEqual([]);
    });

    it('境界: パスがどの層にも属さない文書は逆流検査の対象外(実在検査だけが効く)', () => {
      const model = docsModel([
        scannedDoc({ file: 'docs/specs/domain/foo/entity.md', docType: 'entity_spec', id: 'entity-foo' }),
        scannedDoc({ file: 'fixture.md', docType: 'architecture', frontmatter: { norms: ['entity-foo'] } }),
      ]);

      expect(referenceExistenceVerifier.verify(model)).toEqual([]);
    });
  });
});
