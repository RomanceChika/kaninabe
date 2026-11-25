/**
 * HTML の本の設定の章(`html/config-chapter.ts`)のテスト。下段の表のセルの識別子が等幅の字になり、字は逃がされることを見る。
 */

import { describe, expect, it } from 'vitest';

import { configChapter, tableCell } from '../../../../../lib/generate/render/book/html/config-chapter.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

describe('tableCell', () => {
  it('バッククォートの中だけを等幅にし、ほかは字として逃がす', () => {
    expect(tableCell('鍵 `A_KEY` と <b>\\| x')).toBe('鍵 <span class="bf-mono">A_KEY</span> と &#60;b&#62;| x');
  });
});

describe('configChapter', () => {
  it('設定カタログが読めないときは、題とその旨の 1 行だけ', () => {
    const chapter = configChapter(bookModel(), bookCtx(), null, 'docs/book/config.md', 'docs/book/config.html');
    expect(chapter.headings).toEqual([]);
    expect(chapter.body).toContain('まだ設定カタログを読めていない');
  });
});
