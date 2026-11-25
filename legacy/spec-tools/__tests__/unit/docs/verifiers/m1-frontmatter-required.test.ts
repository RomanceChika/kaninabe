/**
 * M1(フロントマター必須項目)の規約網羅テスト。
 * 対象の要求: frontmatter_policy.md「doc_type ごとの必須フロントマター対応表」。
 */

import { describe, expect, it } from 'vitest';
import { frontmatterRequiredVerifier } from '../../../../lib/docs/verifiers/m1-frontmatter-required.js';
import { docsModel, scannedDoc } from '../../../helpers/docs-builder.js';

/** 欠落として報告された項目名を取り出す。 */
function missingFields(model: Parameters<typeof frontmatterRequiredVerifier.verify>[0]): string[] {
  return frontmatterRequiredVerifier
    .verify(model)
    .map((f) => f.counterexample?.['field'] ?? '')
    .filter((field) => field !== '');
}

describe('M1 フロントマター必須項目', () => {
  it('必須項目が揃っていれば通る', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'principle', id: 'PRIN-0001' }),
      scannedDoc({
        file: 'b.md',
        docType: 'decision',
        id: 'ADR-0001',
        frontmatter: { targets: ['x'], status: 'accepted' },
      }),
      scannedDoc({ file: 'c.md', docType: 'meta' }),
    ]);

    expect(frontmatterRequiredVerifier.verify(model)).toEqual([]);
  });

  it('共通必須(doc_type / scope)の欠落を検出する', () => {
    const model = docsModel([scannedDoc({ file: 'a.md', docType: null, scope: null })]);

    expect(missingFields(model)).toEqual(['doc_type', 'scope']);
  });

  it('doc_type ごとの必須項目の欠落を検出する', () => {
    const model = docsModel([
      scannedDoc({ file: 'guide.md', docType: 'directory_guide', id: null }),
      scannedDoc({ file: 'adr.md', docType: 'decision', id: 'ADR-0001' }),
    ]);

    expect(missingFields(model)).toEqual(['id', 'norms', 'targets', 'status']);
  });

  it('doc_types.md に無い doc_type は警告にする(エラーにはしない)', () => {
    const model = docsModel([scannedDoc({ file: 'a.md', docType: 'recipe' })]);
    const findings = frontmatterRequiredVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.counterexample).toMatchObject({ doc_type: 'recipe' });
  });

  it('境界: 空配列の norms は「参照が無いことの明示」として存在扱いにする', () => {
    const model = docsModel([
      scannedDoc({ file: 'README.md', docType: 'directory_guide', id: 'DG-0001', frontmatter: { norms: [] } }),
    ]);

    expect(frontmatterRequiredVerifier.verify(model)).toEqual([]);
  });

  it('境界: 空文字は欠落として扱う', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'principle', id: 'PRIN-0001', scope: '  ' }),
    ]);

    expect(missingFields(model)).toEqual(['scope']);
  });

  it('docs/specs の仕様 doc_type は未定義扱いにせず、スキーマの中身も数え直さない', () => {
    const model = docsModel([
      scannedDoc({ file: 'specs/domain/workshop/states.md', docType: 'state_spec', id: 'workshop-states' }),
      scannedDoc({ file: 'specs/backend/actions/entry/create.md', docType: 'action_spec', id: 'entry-create-action' }),
      scannedDoc({ file: 'specs/backend/queries/workshop/list.md', docType: 'query_spec', id: 'query-workshop-list' }),
    ]);

    expect(frontmatterRequiredVerifier.verify(model)).toEqual([]);
  });

  it('ドメイン仕様(role/entity/state/access/invariant)の id 欠落は検出する(V 群が文書の id を読まないため)', () => {
    const model = docsModel([
      scannedDoc({ file: 'specs/domain/roles.md', docType: 'role_spec', id: null }),
      scannedDoc({ file: 'specs/domain/workshop/entity.md', docType: 'entity_spec', id: null }),
      scannedDoc({ file: 'specs/domain/workshop/states.md', docType: 'state_spec', id: null }),
      scannedDoc({ file: 'specs/domain/workshop/access.md', docType: 'access_spec', id: null }),
      scannedDoc({ file: 'specs/domain/workshop/invariants.md', docType: 'invariant_spec', id: null }),
    ]);

    expect(missingFields(model)).toEqual(['id', 'id', 'id', 'id', 'id']);
  });

  it('action_spec / query_spec の id 欠落は見ない(A0 / Q0 が導出元との一致まで見るため)', () => {
    const model = docsModel([
      scannedDoc({ file: 'specs/backend/actions/entry/create.md', docType: 'action_spec', id: null }),
      scannedDoc({ file: 'specs/backend/queries/workshop/list.md', docType: 'query_spec', id: null }),
    ]);

    expect(frontmatterRequiredVerifier.verify(model)).toEqual([]);
  });

  it('仕様文書でも共通必須(doc_type / scope)の欠落は見る', () => {
    const model = docsModel([
      scannedDoc({ file: 'specs/domain/roles.md', docType: 'role_spec', id: 'domain-roles', scope: null }),
    ]);

    expect(missingFields(model)).toEqual(['scope']);
  });

  it('doc_type が無ければ doc_type 固有の検査は行わない(まず doc_type を直させる)', () => {
    const model = docsModel([scannedDoc({ file: 'a.md', docType: null })]);

    expect(missingFields(model)).toEqual(['doc_type']);
  });
});
