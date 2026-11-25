/**
 * M6(循環参照)の規約網羅テスト。
 * 対象の要求: norms / decisions の参照グラフが非巡回であること。
 */

import { describe, expect, it } from 'vitest';
import { circularReferenceVerifier } from '../../../../lib/docs/verifiers/m6-circular-reference.js';
import { docsModel, scannedDoc } from '../../../helpers/docs-builder.js';

/** id と norms だけを持つ architecture 文書を作る。 */
function node(id: string, norms: readonly string[]) {
  return scannedDoc({ file: `${id}.md`, docType: 'architecture', id, frontmatter: { norms } });
}

describe('M6 循環参照', () => {
  it('上から下へ一方向に流れるグラフは通る', () => {
    const model = docsModel([
      scannedDoc({ file: 'p.md', docType: 'principle', id: 'PRIN-0001' }),
      node('ARCH-0001', ['PRIN-0001']),
      node('ARCH-0002', ['PRIN-0001', 'ARCH-0001']),
    ]);

    expect(circularReferenceVerifier.verify(model)).toEqual([]);
  });

  it('2 つの文書が互いを参照する循環を検出する', () => {
    const model = docsModel([node('ARCH-0001', ['ARCH-0002']), node('ARCH-0002', ['ARCH-0001'])]);

    const findings = circularReferenceVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.counterexample?.['cycle']).toBe('ARCH-0001 → ARCH-0002 → ARCH-0001');
    expect(findings[0]?.location.file).toBe('ARCH-0001.md');
  });

  it('3 つ以上をまたぐ循環も 1 件にまとめて報告する', () => {
    const model = docsModel([
      node('ARCH-0001', ['ARCH-0002']),
      node('ARCH-0002', ['ARCH-0003']),
      node('ARCH-0003', ['ARCH-0001']),
    ]);

    const findings = circularReferenceVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['members']).toBe('ARCH-0001, ARCH-0002, ARCH-0003');
  });

  it('decisions 経由の循環も検出する', () => {
    const model = docsModel([
      scannedDoc({
        file: 'adr.md',
        docType: 'decision',
        id: 'ADR-0001',
        frontmatter: { norms: ['ARCH-0001'] },
      }),
      scannedDoc({
        file: 'arch.md',
        docType: 'architecture',
        id: 'ARCH-0001',
        frontmatter: { decisions: ['ADR-0001'] },
      }),
    ]);

    expect(circularReferenceVerifier.verify(model)).toHaveLength(1);
  });

  it('境界: 自己参照も循環として検出する', () => {
    const model = docsModel([node('ARCH-0001', ['ARCH-0001'])]);

    const findings = circularReferenceVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['cycle']).toBe('ARCH-0001 → ARCH-0001');
  });

  it('境界: 実在しない参照先は辺にしない(M3 の担当)', () => {
    const model = docsModel([node('ARCH-0001', ['ARCH-9999'])]);

    expect(circularReferenceVerifier.verify(model)).toEqual([]);
  });

  it('境界: 独立した循環が 2 つあれば 2 件報告する', () => {
    const model = docsModel([
      node('ARCH-0001', ['ARCH-0002']),
      node('ARCH-0002', ['ARCH-0001']),
      node('ARCH-0003', ['ARCH-0004']),
      node('ARCH-0004', ['ARCH-0003']),
    ]);

    expect(circularReferenceVerifier.verify(model)).toHaveLength(2);
  });
});
