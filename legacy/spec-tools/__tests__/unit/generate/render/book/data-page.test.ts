/**
 * データの置き場の章(HTML の本。render/book/html/data-chapter.ts)のテスト。
 *
 * 集約の表も集約ではない表も同じ章に並べ、テーブル仕様の標識を本数つきで引用する。
 * 置き場が無い環境では章を作らない。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { dataTable, dataTableModel } from '../../../../helpers/data-builder.js';

const doc = (sign: string): string => ['---', 'doc_type: data_table', '---', '', sign, ''].join('\n');

function ctxWith(tables: ReturnType<typeof dataTable>[], sources: ReadonlyArray<readonly [string, string]>) {
  const base = bookCtx();
  return {
    ...base,
    dataTables: dataTableModel(tables),
    specSources: new Map([...(base.specSources ?? []), ...sources]),
  };
}

describe('データの置き場の章(HTML)', () => {
  const tables = [dataTable('workshops', { entity: 'workshop' }), dataTable('jobs', { internal: true })];
  const page = (ctx: ReturnType<typeof ctxWith>): string | undefined => bookHtmlPage(bookModel(), ctx, 'data.html');

  it('docs/book/data.html をファイル全体(wholeFile)で生成し、置き場が無い環境では生成しない', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), ctxWith(tables, [])).filter((section) => section.file === 'docs/book/data.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
    expect(page(bookCtx() as ReturnType<typeof ctxWith>)).toBeUndefined();
  });

  it('表の一覧に種類(集約の表 / 集約ではない表)と標識の本数を出す', () => {
    const ctx = ctxWith(tables, [['docs/specs/backend/data/tables/workshops.md', doc('- 索引は 1 本に絞った。')]]);
    const text = pageText(page(ctx) ?? '');

    expect(text).toContain('workshops | 集約 workshop の表 | 1 |');
    expect(text).toContain('jobs | 集約ではない表 | 0 |');
  });

  it('標識のあるテーブル仕様だけを、表の見出しの下に本数つきで引用する', () => {
    const ctx = ctxWith(tables, [['docs/specs/backend/data/tables/workshops.md', doc('- 索引は 1 本に絞った。')]]);
    const html = page(ctx) ?? '';
    const text = pageText(html);

    expect(text).toContain('テーブル仕様');
    expect(html).toMatch(/<h3[^>]*>workshops/);
    expect(text).toContain('標識 1 本 — backend/data/tables/workshops.md に残された手書きの判断');
    expect(text).toContain('- 索引は 1 本に絞った。');
    expect(html).not.toMatch(/<h3[^>]*>jobs/);
  });
});
