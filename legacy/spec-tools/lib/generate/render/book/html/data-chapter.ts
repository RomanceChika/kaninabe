/**
 * 「データの置き場(テーブル仕様)」の章の HTML 版。
 *
 * 中身は `data-page.ts` の事実と語で、並びは: 章の頭の 1 行 → 導入 → (全章に展開しているとき)補足 → テーブル一覧 → テーブル仕様(標識のある表ごと)。
 * この章は層の章の骨格を持たないので、共有の部品で節と表を組む。行と定型の文は `data-page.ts` が export したものを使う。
 *
 * 表ごとの見出しは、`id`(表名のスラッグ)を持つ `h3` を出力の口で組み、目次にも積む。標識の引用は本文に並べず折りたたみ(`signFold`)に入れる。
 * 仕様ファイルのリンクは相対パス(仕様のファイルへの繋ぎ)。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { DataTableSpecModel } from '../../../../model/data/types.js';
import { collectSigns } from '../../../prose.js';
import { headingSlug } from '../../html.js';
import { relativeHref } from '../chapters.js';
import { bookLayout } from '../face-scope.js';
import { TABLE_SECTION } from '../sections.js';
import { DATA_TITLE, LEAD, LIST_HEADERS, LIST_HEADING, NESTED_LEAD, kindText, ownTables } from '../data-page.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { countLine } from './count-line.js';
import { inline, mono } from './face-parts.js';
import { signFold } from './layer-chapter.js';
import { el, join, url, type Child } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { DATA_TITLE };

/**
 * データの置き場の章の本文と目次。
 *
 * @param available 読み込み済みのテーブル仕様
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function dataChapter(model: SpecModel, ctx: GenerateContext, available: DataTableSpecModel, countKey: string, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const tables = ownTables(model, ctx, available);
  const signs = (spec: string): number => collectSigns(ctx.specSources?.get(spec) ?? '').length;
  const specTables = (): Child[] =>
    tables.map((entry, index) => {
      const quotes = signFold(entry.location.file, ctx, file);
      if (quotes === null) return null;
      const id = headingSlug(entry.table) || `table-${index + 1}`;
      headings.push({ level: 3, id, title: el('span', null, entry.table) });
      return [el('h3', { id }, entry.table), quotes];
    });
  const body = join([
    el('h1', null, DATA_TITLE),
    countLine(model, ctx, countKey),
    el('p', null, inline(LEAD)),
    bookLayout(model, ctx).nested ? el('p', null, inline(NESTED_LEAD)) : null,
    section('list', LIST_HEADING, headings, () =>
      table(
        LIST_HEADERS,
        tables.map((entry) => [
          mono(entry.table),
          kindText(entry),
          String(signs(entry.location.file)),
          el('a', { href: url(relativeHref(file, entry.location.file)) }, entry.relPath),
        ]),
      ),
    ),
    section('specs', TABLE_SECTION, headings, specTables),
  ]);
  return { body, headings };
}
