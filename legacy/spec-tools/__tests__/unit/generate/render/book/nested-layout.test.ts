/**
 * 章の入れ子(従属する集約は親の章の節になり、独立の章を持たない)のテスト。
 *
 * 全章に展開しているとき(`humanFaceChapters: 'all'`)だけ、従属する集約と集約に結ばれた表は親の章へ寄る。
 * 章立て・標識の割り付け・集約の章の生成・表紙・データの置き場・手引きの未記入が、同じ導出(`bookLayout`)を読む。
 */

import { describe, expect, it } from 'vitest';
import { bookChapters } from '../../../../../lib/generate/render/book/chapters.js';
import { blockOf } from '../../../../../lib/generate/render/book/chapter-files.js';
import { bookLayout } from '../../../../../lib/generate/render/book/face-scope.js';
import { bookHtmlFiles, bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import { dataTable, dataTableModel } from '../../../../helpers/data-builder.js';
import { faceCtx, faceModel } from '../../../../helpers/face-fixture.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const model = faceModel();
const nested: GenerateContext = {
  ...faceCtx('all'),
  // 仕組みの表(集約に結ばれない)を 1 枚足す。
  dataTables: dataTableModel([...(faceCtx('all').dataTables?.tables ?? []), dataTable('jobs', { internal: true })]),
};
const flat: GenerateContext = { ...nested, humanFaceChapters: 0 };

describe('章立て(bookChapters)', () => {
  it('従属する集約は章を持たず、親の章が畳んだ集約を持つ。章は重い順に並ぶ', () => {
    const chapters = bookChapters(model, nested).filter((chapter) => chapter.group === 'domain');

    expect(chapters.map((chapter) => chapter.aggregate)).toEqual(['workshop', 'entry', 'member']);
    expect(chapters.find((chapter) => chapter.aggregate === 'workshop')?.folded).toEqual(['workshop_part', 'workshop_check']);
    expect(chapters.find((chapter) => chapter.aggregate === 'entry')?.folded).toBeUndefined();
    expect(chapters.map((chapter) => chapter.aggregate)).not.toContain('workshop_part');
  });

  it('全章に展開していないときは、従来どおり全集約が章を持つ', () => {
    const chapters = bookChapters(model, flat).filter((chapter) => chapter.group === 'domain');

    expect(chapters.map((chapter) => chapter.aggregate)).toContain('workshop_part');
    expect(chapters.every((chapter) => chapter.folded === undefined)).toBe(true);
  });

  it('集約の章の生成は、章を持つ集約の分だけ(従属する集約のファイルは作らない)', () => {
    const files = [...bookHtmlFiles(model, nested).keys()];

    expect(files).toContain('docs/book/domain/workshop.html');
    expect(files).not.toContain('docs/book/domain/workshop_part.html');
    expect(files).not.toContain('docs/book/domain/workshop_check.html');
  });
});

describe('標識の割り付け(blockOf)', () => {
  const layout = bookLayout(model, nested);
  const at = (file: string) => blockOf(file, model, TEST_ROOTS, layout);

  it('従属する集約の仕様ファイルと操作は、親の章の同じ節に載る', () => {
    expect(at('docs/specs/domain/workshop_part/invariants.md')).toEqual({
      chapter: 'docs/book/domain/workshop.md',
      section: '破ってはいけないこと(不変条件)',
    });
    expect(at('docs/specs/backend/actions/workshop_part/create.md')?.chapter).toBe('docs/book/domain/workshop.md');
    // 自分の章を持つ集約(枠)は、そのまま。
    expect(at('docs/specs/domain/entry/entity.md')?.chapter).toBe('docs/book/domain/entry.md');
  });

  it('集約に結ばれたテーブル仕様は、その集約が載る章へ寄る。結ばれない表は「データの置き場」に残る', () => {
    expect(at('docs/specs/backend/data/tables/workshop_parts.md')).toEqual({
      chapter: 'docs/book/domain/workshop.md',
      section: 'テーブル仕様',
    });
    expect(at('docs/specs/backend/data/tables/entries.md')?.chapter).toBe('docs/book/domain/entry.md');
    expect(at('docs/specs/backend/data/tables/jobs.md')?.chapter).toBe('docs/book/data.md');
  });

  it('畳まない文脈(layout なし・全章でない)では、集約ごとの章と「データの置き場」のまま', () => {
    expect(blockOf('docs/specs/domain/workshop_part/entity.md', model, TEST_ROOTS)?.chapter).toBe('docs/book/domain/workshop_part.md');
    expect(blockOf('docs/specs/backend/data/tables/workshop_parts.md', model, TEST_ROOTS, bookLayout(model, flat))?.chapter).toBe(
      'docs/book/data.md',
    );
  });
});

describe('表紙とデータの置き場と手引き(HTML)', () => {
  it('表紙は、従属する集約を親の章の下に入れ子の一覧として並べる(新しい形の章へ直接繋ぐ)', () => {
    const html = bookHtmlPage(model, nested, 'index.html') ?? '';

    expect(html).toContain('<li><a href="./spec/workshop.html">集約 workshop(催し)</a><ul><li><a href="./spec/workshop_part.html">集約 workshop_part(部)</a></li>');
    expect(html).toContain('<li><a href="./spec/entry.html">集約 entry(枠');
  });

  it('データの置き場には、仕組みの表と集約に結ばれない表だけが残る', () => {
    const text = pageText(bookHtmlPage(model, nested, 'data.html') ?? '');

    expect(text).toMatch(/^jobs \|/m);
    expect(text).not.toMatch(/^workshops \|/m);
    expect(text).not.toMatch(/^workshop_parts \|/m);
    expect(text).toContain('集約に結ばれた表の標識は、その集約の章の受け入れに置いた');
  });

  it('全章に展開していないときは、集約の表もデータの置き場に並ぶ', () => {
    const text = pageText(bookHtmlPage(model, flat, 'data.html') ?? '');

    expect(text).toMatch(/^workshops \|/m);
    expect(text).not.toContain('集約に結ばれた表の標識は');
  });

  it('手引きの未記入は、章ごと(従属する集約の分は親の章に足す)に数える', () => {
    const html = bookHtmlPage(model, nested, 'review-guide.html') ?? '';
    const text = pageText(html);

    // 催しの章頭 1 + 畳んだ従属 2 の章頭 = 3。節の要約 2・段の場面 6 は催しの分。
    expect(text).toMatch(/^集約 workshop\(催し\) \| 3 \| 2 \| 6 \| 11 \| 0 \/ 11/m);
    expect(html).not.toContain('./domain/workshop_part.html');
  });
});
