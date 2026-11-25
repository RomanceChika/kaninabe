/**
 * M4(リンク切れ)の規約網羅テスト。
 * 対象の要求: 本文の相対リンクが実在するファイルを指すこと。
 * 何をリンクとして拾うか(コード・AUTO-GENERATED の除外)は markdown-links のテスト、
 * 範囲(CLAUDE.md と docs/ の下の全部の .md)と実在判定は link-scan のテストで実証する。
 */

import { describe, expect, it } from 'vitest';
import { markdownLinkVerifier } from '../../../../lib/docs/verifiers/m4-markdown-link.js';
import { docsModel, link, linkedFile } from '../../../helpers/docs-builder.js';

describe('M4 リンク切れ', () => {
  it('すべてのリンクが解決できていれば通る', () => {
    const model = docsModel([], [linkedFile('a.md', [link('./b.md'), link('../c/README.md')])]);

    expect(markdownLinkVerifier.verify(model)).toEqual([]);
  });

  it('解決できないリンクを検出する', () => {
    const model = docsModel([], [linkedFile('a.md', [link('./ok.md'), link('./missing.md', false, 12)])]);

    const findings = markdownLinkVerifier.verify(model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('./missing.md');
    expect(findings[0]?.location.file).toBe('a.md');
    expect(findings[0]?.location.pointer).toBe('L12');
    expect(findings[0]?.counterexample).toMatchObject({ href: './missing.md', line: '12' });
  });

  it('同じファイルに複数のリンク切れがあれば全件報告する', () => {
    const model = docsModel([], [linkedFile('a.md', [link('./x.md', false), link('./y.md', false)])]);

    expect(markdownLinkVerifier.verify(model)).toHaveLength(2);
  });

  it('複数のファイル(フロントマターを持たない文書・根の文書を含む)の切れを、それぞれのファイルで報告する', () => {
    const model = docsModel(
      [],
      [linkedFile('CLAUDE.md', [link('docs/x.md', false)]), linkedFile('docs/design/y.md', [link('./z.md', false)])],
    );

    expect(markdownLinkVerifier.verify(model).map((finding) => finding.location.file)).toEqual([
      'CLAUDE.md',
      'docs/design/y.md',
    ]);
  });

  it('境界: リンクが 1 つも無いファイルは違反にならない', () => {
    expect(markdownLinkVerifier.verify(docsModel([], [linkedFile('a.md', [])]))).toEqual([]);
  });
});
