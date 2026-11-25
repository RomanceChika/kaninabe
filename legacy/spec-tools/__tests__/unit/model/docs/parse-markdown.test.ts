/**
 * parse-markdown(見出しの抽出)のテスト。
 * 対象の要求: 走査から除外するもの(フロントマター・コードブロック・HTML コメント)と、見出しの正規化、
 * およびフロントマターの区切りが閉じているかの判定。
 */

import { describe, expect, it } from 'vitest';
import {
  frontmatterDelimiter,
  isOptionalHeading,
  isRepeatableHeading,
  normalizeHeading,
  parseMarkdown,
} from '../../../../lib/model/docs/parse-markdown.js';

/** 見出しテキストだけを取り出す。 */
function headingTexts(source: string): string[] {
  return parseMarkdown(source).headings.map((h) => h.text);
}

describe('parseMarkdown 見出しの抽出', () => {
  it('ATX 見出しをレベル付きで拾う', () => {
    const parsed = parseMarkdown('# 題\n\n## 目的\n\n### 詳細\n');

    expect(parsed.headings).toEqual([
      { level: 1, text: '題', raw: '題', line: 1 },
      { level: 2, text: '目的', raw: '目的', line: 3 },
      { level: 3, text: '詳細', raw: '詳細', line: 5 },
    ]);
  });

  it('フロントマターの中は見出しとして拾わない', () => {
    expect(headingTexts('---\ndoc_type: process\n# コメントではない値\n---\n\n## 目的\n')).toEqual([
      '目的',
    ]);
  });

  it('コードブロックの中の見出しは拾わない', () => {
    const source = '## 目的\n\n```md\n## コード内\n```\n\n## 手順\n';

    expect(headingTexts(source)).toEqual(['目的', '手順']);
  });

  it('HTML コメントの中の見出しは拾わない(複数行も)', () => {
    const source = '## 目的\n\n<!--\n## コメント内\n-->\n\n## 手順\n';

    expect(headingTexts(source)).toEqual(['目的', '手順']);
  });

  it('AUTO-GENERATED ブロックの中の見出しは拾う(生成物も構造の一部)', () => {
    const source = '<!-- AUTO-GENERATED:x -->\n## 生成された節\n<!-- /AUTO-GENERATED:x -->\n';

    expect(headingTexts(source)).toEqual(['生成された節']);
  });

  it('境界: 見出しに見えるだけの行(# の後ろに空白が無い)は拾わない', () => {
    expect(headingTexts('#タグではない\n\n## 目的\n')).toEqual(['目的']);
  });
});

describe('見出しの正規化', () => {
  it('アンカーと注記を落とす', () => {
    expect(normalizeHeading('原則 {#statement}')).toBe('原則');
    expect(normalizeHeading('前提条件（任意）')).toBe('前提条件');
    expect(normalizeHeading('目的（必須）')).toBe('目的');
  });

  it('(任意) が付いた見出しだけを省略可と判定する', () => {
    expect(isOptionalHeading('前提条件（任意）')).toBe(true);
    expect(isOptionalHeading('目的（必須）')).toBe(false);
    expect(isOptionalHeading('目的')).toBe(false);
  });

  it('プレースホルダーと連番を含む見出しを繰り返しパターンと判定する', () => {
    expect(isRepeatableHeading('{リソース名} の仕様')).toBe(true);
    expect(isRepeatableHeading('手順N: 実装')).toBe(true);
    expect(isRepeatableHeading('目的')).toBe(false);
  });

  it('末尾のアンカーは繰り返しパターンと見なさない', () => {
    expect(isRepeatableHeading('原則 {#statement}')).toBe(false);
    expect(isRepeatableHeading('{リソース名} の仕様 {#spec}')).toBe(true);
  });
});

describe('frontmatterDelimiter フロントマターの区切り', () => {
  it('閉じ "---" があれば closed', () => {
    expect(frontmatterDelimiter('---\ndoc_type: meta\n---\n\n# 見出し\n')).toBe('closed');
  });

  it('フロントマターが無ければ none', () => {
    expect(frontmatterDelimiter('# 見出しだけ\n')).toBe('none');
  });

  /**
   * 実際に起きた事故の形。gray-matter は閉じ "---" が無くても末尾までを
   * フロントマターとして読むため、この判定を別に持たないと壊れたファイルが素通りする。
   */
  it('開いたまま切れていれば unclosed', () => {
    expect(frontmatterDelimiter('---\ndoc_type: directory_guide\nscope: backend\n\n')).toBe(
      'unclosed',
    );
  });

  it('CRLF の実事故形でも unclosed と判定する', () => {
    expect(
      frontmatterDelimiter('---\r\ndoc_type: directory_guide\r\nid: DG-BE-0012\r\nscope: backend\r\n\r\n'),
    ).toBe('unclosed');
  });

  it('境界: BOM 付きでも先頭の区切りとして認める', () => {
    expect(frontmatterDelimiter('﻿---\ndoc_type: meta\n---\n')).toBe('closed');
    expect(frontmatterDelimiter('﻿---\ndoc_type: meta\n')).toBe('unclosed');
  });

  /**
   * 既知の限界。直したときにこのテストが落ちて気づけるように、現状の挙動として固定する。
   * どちらも「見逃す」側で、実害が観測されている形(区切りが最後まで現れない)は捕まる。
   */
  it('既知の限界: 本文中の水平線を閉じ区切りと見なす(閉じ忘れを見逃す)', () => {
    expect(frontmatterDelimiter('---\ndoc_type: meta\n\n# 見出し\n\n---\n\n続き\n')).toBe('closed');
  });

  it('既知の限界: 閉じてさえいれば本文が空でも何も言わない(M5 の emptyBody が拾う)', () => {
    expect(frontmatterDelimiter('---\ndoc_type: directory_guide\nscope: common\n---\n')).toBe(
      'closed',
    );
  });
});
