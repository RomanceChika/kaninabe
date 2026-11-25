/**
 * 章の頭の 1 行(`html/count-line.ts`。この章の標識と判断ポイントの数)のテスト。
 *
 * 手引きの章の行と同じ集計(`chapterLoads`)から出ること・標識と判断ポイントを並べて足した数は出さないこと・精読が要らないと宣言した章には出さないことを見る。
 */

import { describe, expect, it } from 'vitest';
import { countLine } from '../../../../../lib/generate/render/book/html/count-line.js';
import { chapterLoads } from '../../../../../lib/generate/render/book/chapter-loads.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { pageText } from '../../../../helpers/book-html.js';

describe('countLine: 章の頭の 1 行', () => {
  it('標識と判断ポイントを並べて出し、足した数は出さない(手引きと同じ集計)', () => {
    const ctx = bookCtx();
    const load = chapterLoads(bookModel(), ctx).find((candidate) => candidate.chapter.file === 'docs/book/domain/workshop.md');
    const line = countLine(bookModel(), ctx, 'docs/book/domain/workshop.md');
    const html = line ?? '';

    expect(load).toBeDefined();
    expect(pageText(html)).toContain(`標識 ${load?.signCount} 本・判断ポイント ${load?.declCount} 件`);
    expect(pageText(html)).toContain('単位が違うので足さない');
    expect(html).toContain('<a href="./review-guide.html">レビューの手引き</a>');
  });

  it('精読不要と宣言した章には出さない', () => {
    expect(countLine(bookModel(), bookCtx(), 'docs/book/sweep.md')).toBeNull();
  });

  it('集計に無い章には出さない(数が引けない)', () => {
    expect(countLine(bookModel(), bookCtx(), 'docs/book/nothing.md')).toBeNull();
  });
});
