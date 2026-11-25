/**
 * HTML の本の表紙(`html/index-chapter.ts`)のテスト。
 *
 * 並び(外している守り → 言葉 → 規模 → 集約関係図 → ロール → 章立て)・目次が本文と同じ順・集約の章は新しい形(`spec/*.html`)へ繋ぎ、
 * まだ移していない章は `.md` へ繋がないこと・製品の一言が構造にならないことを見る。
 */

import { describe, expect, it } from 'vitest';

import { coverChapter } from '../../../../../lib/generate/render/book/html/index-chapter.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

const HOSTILE = '<img src=x onerror=alert(1)>';

describe('coverChapter', () => {
  const base = bookCtx();
  const cover = coverChapter(bookModel(), { ...base, roots: { ...base.roots, summary: HOSTILE } });

  it('節は 外している守り → 言葉 → 規模 → 集約関係図 → ロール → 章立て の順で、目次も同じ順', () => {
    const ids = cover.headings.filter((heading) => heading.level === 2).map((heading) => heading.id);
    expect(ids).toEqual(['exempt', 'glossary', 'scale', 'graph', 'roles', 'toc']);
    const positions = ids.map((id) => cover.body.indexOf(`<h2 id="${id}">`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('集約関係図は SVG で、節はその集約の章へ繋ぐ', () => {
    expect(cover.body).toContain('<svg class="bf-fl-svg"');
    expect(cover.body).toMatch(/<a href="\.\/spec\/[a-z_]+\.html"><g class="bf-ag-node">/);
  });

  it('集約の章は spec/*.html へ繋ぎ、.md へは繋がない', () => {
    expect(cover.body).toContain('href="./spec/index.html"');
    expect(cover.body).toMatch(/href="\.\/spec\/[a-z_]+\.html"/);
    expect(cover.body).not.toMatch(/href="[^"]*\.md"/);
  });

  it('製品の一言は字として逃がされる', () => {
    expect(cover.body).not.toContain('<img');
    expect(cover.body).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });
});
