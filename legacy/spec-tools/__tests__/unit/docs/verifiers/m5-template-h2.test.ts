/**
 * M5(テンプレート準拠 H2)の規約網羅テスト。
 * 対象の要求: template_policy.md で解決したテンプレートの H2 と文書の H2 が一致すること。
 * テンプレートの解決手順そのものは loader のテストで実証する。
 */

import { describe, expect, it } from 'vitest';
import { templateH2Verifier } from '../../../../lib/docs/verifiers/m5-template-h2.js';
import { docsModel, heading, scannedDoc, template } from '../../../helpers/docs-builder.js';

describe('M5 テンプレート準拠(H2)', () => {
  it('H2 がテンプレートと一致すれば通る', () => {
    const model = docsModel([
      scannedDoc({
        file: 'a.md',
        h2: ['目的', '手順'],
        template: template({ h2: ['目的', '手順', '関連ドキュメント?'] }),
      }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('テンプレートにある必須 H2 の欠落を警告する', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', h2: ['目的'], template: template({ h2: ['目的', '手順'] }) }),
    ]);

    const findings = templateH2Verifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('## 手順');
  });

  it('テンプレートに無い H2 も警告する', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', h2: ['目的', '余計な節'], template: template({ h2: ['目的'] }) }),
    ]);

    const findings = templateH2Verifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('## 余計な節');
    expect(findings[0]?.counterexample).toMatchObject({
      heading: '余計な節',
      template: 'docs/rules/process/template.md',
    });
  });

  it('(任意) の H2 は省略しても違反にならず、書いてあっても余計扱いしない', () => {
    const optional = template({ h2: ['目的', '前提条件?'] });
    const model = docsModel([
      scannedDoc({ file: 'a.md', h2: ['目的'], template: optional }),
      scannedDoc({ file: 'b.md', h2: ['目的', '前提条件'], template: optional }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('H1・H3 は比較しない(見るのは H2 の集合だけ)', () => {
    const model = docsModel([
      scannedDoc({
        file: 'a.md',
        headings: [heading(1, 'タイトル'), heading(2, '目的'), heading(3, '内訳')],
        template: template({ h2: ['目的'] }),
      }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('語彙が開いたテンプレートでは、テンプレートに無い H2 を咎めない', () => {
    const model = docsModel([
      scannedDoc({
        file: 'README.md',
        docType: 'directory_guide',
        h2: ['一覧', 'このディレクトリ固有の節'],
        template: template({ h2: ['目的?', '一覧?', '関連?'], openH2: true }),
      }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('語彙が開いていても、必須 H2 の欠落は警告する', () => {
    const model = docsModel([
      scannedDoc({
        file: 'README.md',
        docType: 'directory_guide',
        h2: ['固有の節'],
        template: template({ h2: ['一覧', '関連?'], openH2: true }),
      }),
    ]);

    const findings = templateH2Verifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('## 一覧');
  });

  it('語彙が開いたテンプレートで H2 がひとつも無い文書を警告する', () => {
    const model = docsModel([
      scannedDoc({
        file: 'README.md',
        docType: 'directory_guide',
        h2: [],
        template: template({ h2: ['目的?', '一覧?'], openH2: true }),
      }),
    ]);

    const findings = templateH2Verifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('ひとつもありません');
  });

  it('docs/specs の仕様文書は、テンプレートが解決できても対象外(本文は生成物が主)', () => {
    const model = docsModel([
      scannedDoc({
        file: 'specs/domain/workshop/states.md',
        docType: 'state_spec',
        id: 'workshop-states',
        h2: ['固有の節'],
        template: template({ h2: ['状態遷移図', '遷移表'], docType: 'state_spec' }),
      }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('docs/specs にあっても README(directory_guide)は対象に残す', () => {
    const model = docsModel([
      scannedDoc({
        file: 'specs/domain/README.md',
        docType: 'directory_guide',
        id: 'DG-0038',
        h2: [],
        template: template({ h2: ['一覧?'], docType: 'directory_guide', openH2: true }),
      }),
    ]);

    const findings = templateH2Verifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ひとつもありません');
  });

  it('境界: テンプレートが解決できない文書は対象外', () => {
    const model = docsModel([scannedDoc({ file: 'a.md', h2: ['なんでも'], template: null })]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('境界: 繰り返しパターンを含むテンプレートは対象外', () => {
    const model = docsModel([
      scannedDoc({
        file: 'a.md',
        h2: ['なんでも'],
        template: template({ h2: ['{リソース名}'], repeatable: true }),
      }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });

  it('境界: H2 を 1 つも定めていないテンプレートは対象外', () => {
    const model = docsModel([
      scannedDoc({ file: 'a.md', h2: ['なんでも'], template: template({ h2: [] }) }),
    ]);

    expect(templateH2Verifier.verify(model)).toEqual([]);
  });
});
