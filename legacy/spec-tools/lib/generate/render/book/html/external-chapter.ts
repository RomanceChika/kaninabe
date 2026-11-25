/**
 * 「外と何をやり取りするか(外部連携)」の章の HTML 版。
 *
 * 中身は `external-page.ts` / `external-paid-section.ts` の事実と語で、並びは:
 * 章の頭の 1 行 → 導入 → 連携の表 → 送る情報の読み方 → ブラウザから叩かれる口 → 有料の資源を使う口 → 同じ知らせが二度届きうる経路 → 標識。
 * この章は層の章の骨格(読む量の 4 枚・上段/下段)を持たないので、`layer-chapter.ts` は使わず、共有の部品で節と表を組む。
 * 表の行と定型の文は上の各ファイルが export したものを使う(文は `inline` で読む)。
 *
 * 送る情報の読み方にある可視性の章へのリンクは、HTML の本の中の章へ繋ぐ(`chapterHref`。移していない章は題だけ)。
 * 標識の引用は、本文に並べず折りたたみ(`signFold`)に入れる。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { ExternalCatalogSpec } from '../../../../model/external/types.js';
import { externalFile } from '../../external-body.js';
import { bookFile } from '../chapters.js';
import {
  DUPLICATE_HEADERS,
  DUPLICATE_HEADING,
  DUPLICATE_LEAD,
  DUPLICATE_NONE,
  ENDPOINTS_HEADERS,
  ENDPOINTS_HEADING,
  ENDPOINTS_LEAD,
  EXTERNAL_TITLE,
  INTEGRATION_HEADERS,
  INTEGRATION_HEADING,
  LEAD,
  NO_CATALOG,
  NO_INTEGRATIONS,
  SENDS_NOTE_HEAD,
  SENDS_NOTE_LINK,
  SENDS_NOTE_TAIL,
  duplicateRows,
  endpointRows,
  integrationRows,
} from '../external-page.js';
import { PAID_HEADER, PAID_HEADING, PAID_LEAD, paidRows } from '../external-paid-section.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { countLine } from './count-line.js';
import { inline } from './face-parts.js';
import { chapterHref } from './index-chapter.js';
import { signFold } from './layer-chapter.js';
import { el, join, url, type Child } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { EXTERNAL_TITLE };

/** 表(セルは共有の文なので `inline` で読む)。 */
function sharedTable(headers: readonly string[], rows: readonly (readonly string[])[]): Child {
  return table(
    headers,
    rows.map((row) => row.map((value) => inline(value))),
  );
}

/** 送る情報の読み方(可視性の章へは、HTML の本の中の章へ繋ぐ)。 */
function sendsNote(model: SpecModel, ctx: GenerateContext): Child {
  const href = chapterHref(model, ctx, bookFile(ctx.roots, 'visibility.md'));
  return el('p', null, inline(SENDS_NOTE_HEAD), href === null ? SENDS_NOTE_LINK : el('a', { href: url(href) }, SENDS_NOTE_LINK), SENDS_NOTE_TAIL);
}

/** カタログがあるときの節の並び(出す節だけ)。 */
function sections(model: SpecModel, ctx: GenerateContext, catalog: ExternalCatalogSpec, headings: PageHeading[]): Child[] {
  const endpoints = endpointRows(catalog);
  const paid = paidRows(catalog, ctx);
  const duplicates = duplicateRows(catalog);
  const integrations = integrationRows(catalog);
  return [
    section('integrations', INTEGRATION_HEADING, headings, () => [
      integrations.length === 0 ? el('p', null, NO_INTEGRATIONS) : sharedTable(INTEGRATION_HEADERS, integrations),
      sendsNote(model, ctx),
    ]),
    endpoints.length === 0 ? null : section('endpoints', ENDPOINTS_HEADING, headings, () => [el('p', null, inline(ENDPOINTS_LEAD)), sharedTable(ENDPOINTS_HEADERS, endpoints)]),
    paid.length === 0 ? null : section('paid', PAID_HEADING, headings, () => [el('p', null, inline(PAID_LEAD)), sharedTable(PAID_HEADER, paid)]),
    section('duplicates', DUPLICATE_HEADING, headings, () =>
      duplicates.length === 0 ? el('p', null, DUPLICATE_NONE) : [el('p', null, inline(DUPLICATE_LEAD)), sharedTable(DUPLICATE_HEADERS, duplicates)],
    ),
  ];
}

/**
 * 外部連携の章の本文と目次。
 *
 * @param catalog 外部連携カタログ(読めていなければ null)
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function externalChapter(model: SpecModel, ctx: GenerateContext, catalog: ExternalCatalogSpec | null, countKey: string, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const body = join([
    el('h1', null, EXTERNAL_TITLE),
    countLine(model, ctx, countKey),
    el('p', null, inline(LEAD)),
    catalog === null ? el('p', null, NO_CATALOG) : sections(model, ctx, catalog, headings),
    signFold(externalFile(ctx.roots), ctx, file),
  ]);
  return { body, headings };
}
