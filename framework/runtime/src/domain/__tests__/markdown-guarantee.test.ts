/**
 * 保証 fw_markdown_sanitize の見張り: 敵対的な入力の表の全行で、書式つきの本文の描画が許可リストの外へ出ない。
 * 表と検算器は `markdown-corpus.ts`(個々の行の失敗は `markdown.test.ts` が行ごとに出す)。
 */

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../markdown';
import { HOSTILE, unsafeFindings } from './markdown-corpus';

/** 表の全行を描いて、許可リストの外へ出た行の一覧を返す(空なら全行が安全)。 */
function leaksOfTable(): string[] {
  return HOSTILE.flatMap(([name, body]) => unsafeFindings(renderMarkdown(body)).map((finding) => name + ': ' + finding));
}

describe('書式つきの本文の描画の保証', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MD-001
  it('敵対的な入力の表は全行で出力が許可リストの外に出ない(件数の固定。足したら数える)', () => {
    expect(HOSTILE.length).toBe(85);
    expect(leaksOfTable()).toEqual([]);
  });
});
