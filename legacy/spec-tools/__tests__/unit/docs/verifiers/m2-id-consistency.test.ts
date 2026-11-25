/**
 * M2(ID 整合)の規約網羅テスト。
 * 対象の要求: id_policy.md「ID の形式」「再利用しない」。
 */

import { describe, expect, it } from 'vitest';
import { idConsistencyVerifier } from '../../../../lib/docs/verifiers/m2-id-consistency.js';
import { docsModel, scannedDoc } from '../../../helpers/docs-builder.js';

describe('M2 ID 整合', () => {
  it('id が一意で形式に合っていれば通る', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'principle', id: 'PRIN-0001-spec-as-truth' }),
      scannedDoc({ file: 'b.md', docType: 'principle', id: 'PRIN-BE-0002' }),
      scannedDoc({ file: 'c.md', docType: 'architecture', id: 'ARCH-SP-BE-0001-x' }),
      scannedDoc({ file: 'd.md', docType: 'decision', id: 'ADR-FE-0003-y' }),
      scannedDoc({ file: 'e.md', docType: 'directory_guide', id: 'DG-BE-0004' }),
    ]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });

  it('id の重複を検出し、宣言している文書をすべて反例に並べる', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'principle', id: 'PRIN-0001' }),
      scannedDoc({ file: 'b.md', docType: 'principle', id: 'PRIN-0001' }),
      scannedDoc({ file: 'c.md', docType: 'principle', id: 'PRIN-0001' }),
    ]);

    const findings = idConsistencyVerifier.verify(model);

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.counterexample?.['declared_in'] === 'a.md, b.md, c.md')).toBe(true);
    expect(findings[0]?.severity).toBe('error');
  });

  it('どちらを直すかは決めず、履歴で確認するよう促す(走査順は採番の先後ではない)', () => {
    const rulesFirst = docsModel([
      scannedDoc({ file: 'docs/rules/README.md', docType: 'directory_guide', id: 'DG-0038' }),
      scannedDoc({ file: 'docs/specs/README.md', docType: 'directory_guide', id: 'DG-0038' }),
    ]);
    const specsFirst = docsModel([
      scannedDoc({ file: 'docs/specs/README.md', docType: 'directory_guide', id: 'DG-0038' }),
      scannedDoc({ file: 'docs/rules/README.md', docType: 'directory_guide', id: 'DG-0038' }),
    ]);

    const declaredIn = (model: typeof rulesFirst): unknown =>
      idConsistencyVerifier.verify(model)[0]?.counterexample?.['declared_in'];

    expect(declaredIn(rulesFirst)).toBe('docs/rules/README.md, docs/specs/README.md');
    expect(declaredIn(specsFirst)).toBe(declaredIn(rulesFirst));
    expect(idConsistencyVerifier.verify(rulesFirst)[0]?.suggestion).toContain('履歴');
  });

  it('docs/specs の id 体系(query-xxx / xxx-action / xxx-states 等)を妥当として受け入れる', () => {
    const model = docsModel([
      scannedDoc({ file: 'roles.md', docType: 'role_spec', id: 'domain-roles' }),
      scannedDoc({ file: 'entity.md', docType: 'entity_spec', id: 'workshop-entity' }),
      scannedDoc({ file: 'states.md', docType: 'state_spec', id: 'workshop-states' }),
      scannedDoc({ file: 'access.md', docType: 'access_spec', id: 'workshop-access' }),
      scannedDoc({ file: 'invariants.md', docType: 'invariant_spec', id: 'workshop-invariants' }),
      scannedDoc({ file: 'create.md', docType: 'action_spec', id: 'program_item-create-action' }),
      scannedDoc({ file: 'close.md', docType: 'action_spec', id: 'workshop-close_manual-action' }),
      scannedDoc({ file: 'list.md', docType: 'query_spec', id: 'query-entry-organizer-list' }),
    ]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });

  it('action_spec / query_spec の id 形式は見ない(A0 / Q0 が導出元との一致まで見るため)', () => {
    const model = docsModel([
      scannedDoc({ file: 'create.md', docType: 'action_spec', id: 'まったく違う形' }),
      scannedDoc({ file: 'list.md', docType: 'query_spec', id: 'workshop_list' }),
    ]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });

  it('rules と specs をまたぐ id 重複も 1 つの台帳として検出する', () => {
    const model = docsModel([
      scannedDoc({ file: 'docs/rules/process/README.md', docType: 'directory_guide', id: 'DG-0038' }),
      scannedDoc({ file: 'docs/specs/domain/README.md', docType: 'directory_guide', id: 'DG-0038' }),
    ]);

    const findings = idConsistencyVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toEqual({
      id: 'DG-0038',
      declared_in: 'docs/rules/process/README.md, docs/specs/domain/README.md',
    });
  });

  it('doc_type ごとの形式に合わない id を検出する', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'principle', id: 'PRINCIPLE-1' }),
      scannedDoc({ file: 'b.md', docType: 'directory_guide', id: 'DG-1' }),
    ]);

    const findings = idConsistencyVerifier.verify(model);

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    expect(findings[0]?.counterexample?.['expected']).toContain('PRIN-0001');
  });

  it('旧採番(directory_guide の PROC-BE-xxxx)は error にする', () => {
    const model = docsModel([
      scannedDoc({ file: 'README.md', docType: 'directory_guide', id: 'PROC-BE-0027' }),
    ]);

    const findings = idConsistencyVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample?.['expected']).toContain('DG-BE-0001');
  });

  it('境界: 形式を規定しない doc_type(meta / spec)の id は検査しない', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'meta', id: 'なんでもよい' }),
      scannedDoc({ file: 'b.md', docType: 'spec', id: 'product.md' }),
    ]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });

  it('境界: id が無い文書は M2 の対象外(必須かどうかは M1 の担当)', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', docType: 'process', id: null }),
      scannedDoc({ file: 'b.md', docType: 'process', id: null }),
    ]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });

  it('境界: doc_types.md に無い doc_type の id は検査しない(M1 が doc_type を指摘する)', () => {
    const model = docsModel([scannedDoc({ file: 'a.md', docType: 'recipe', id: 'なんでもよい' })]);

    expect(idConsistencyVerifier.verify(model)).toEqual([]);
  });
});
