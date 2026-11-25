/**
 * 「レビューの手引き」の章のうち、検証の結果(警告)に依る節の HTML 版: 「読む量」の節と「警告の区分」の節。
 *
 * 中身は `review-guide-reading.ts` / `review-guide-extension.ts` の事実と語。表の行と定型の文はそれらが export したものを使う(文は `inline` で読む)。
 * 必読・受け入れの数と、それを足す表の行の有無は検証の結果(まだ通していない警告)に依るので、**数・表・行は `verified` の印の中**に置く。
 * ハンドブックだけを出す入口は検証を回さないので、印の中だけが全部入りの `generate` と違ってよい(`book-verification-cut.ts`)。見出しと定型の説明は両方の出力で同じ。
 *
 * 「警告の区分」の節は、本は両方の出力(台帳が渡された全部入りの文脈とそれ以外)で目次が同じになるよう、節と小見出しを常に出し、
 * 検証の結果に依る中身だけを印の中に置く(台帳が無いときは印の中が空)。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { blockReadings } from '../block-reading.js';
import { relativeHref } from '../chapters.js';
import { extensionHits, pendingFindings } from '../finding-placement.js';
import {
  CANDIDATES_NONE,
  CANDIDATES_UNREADABLE,
  CANDIDATE_HEADERS,
  EXTENSION_CANDIDATES_HEADING,
  EXTENSION_HEADING,
  EXTENSION_INTRO,
  EXTENSION_UNCLASSIFIED_HEADING,
  UNCLASSIFIED_NONE,
  UNCLASSIFIED_UNCOUNTED,
  candidateRows,
  candidatesLead,
  unclassifiedLead,
  unclassifiedLines,
} from '../review-guide-extension.js';
import {
  READER_NOTES,
  READING_HEADERS,
  READING_HEADING,
  READING_NONE,
  READING_NOTES,
  UNPLACED_HEADING,
  UNPLACED_LEAD,
  UNPLACED_NONE,
  readerData,
  unplacedLines,
} from '../review-guide-reading.js';
import { section, table } from './chapter-parts.js';
import { inline, mono, pts, verified } from './face-parts.js';
import { noteBlocks } from './folded-table.js';
import { el, join, url, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';

/** 小見出し(`h3`)。目次にも積む。 */
function sub(id: string, title: string, headings: PageHeading[]): Html {
  headings.push({ level: 3, id, title: el('span', null, title) });
  return el('h3', { id }, title);
}

/** 読み手 1 人ぶんの小見出しと表(合計と表は検証の結果に依る)。 */
function readerBlock(reader: 'business' | 'developer', model: SpecModel, ctx: GenerateContext, file: string, headings: PageHeading[]): Child[] {
  const data = readerData(reader, blockReadings(model, ctx), model, ctx);
  return [
    sub(`reading-${reader}`, data.heading, headings),
    verified([el('p', null, inline(data.total))], true),
    el('p', null, inline(data.signs)),
    verified(
      [
        data.rows.length === 0
          ? el('p', null, READING_NONE)
          : table(
              [...READING_HEADERS],
              data.rows.map((row) => [
                row.title,
                row.section,
                el('a', { href: url(relativeHref(file, row.file)) }, row.shown),
                row.required,
                row.changed,
                row.accept,
                row.signWord,
              ]),
            ),
      ],
      true,
    ),
  ];
}

/** どの章にも配れないもの(警告・消えた公理)。 */
function unplaced(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Child[] {
  const lines = unplacedLines(model, ctx);
  return [
    sub('reading-unplaced', UNPLACED_HEADING, headings),
    el('p', null, inline(UNPLACED_LEAD)),
    verified([lines.length === 0 ? el('p', null, UNPLACED_NONE) : pts(lines.map((line) => inline(line)))], true),
  ];
}

/**
 * 「読む量」の節。
 *
 * @param file 書き出すファイル(リポジトリルート相対。仕様ファイルへのリンクの起点)
 */
export function readingSection(model: SpecModel, ctx: GenerateContext, file: string, headings: PageHeading[]): Html {
  return section('reading', READING_HEADING, headings, () => [
    noteBlocks(READING_NOTES),
    noteBlocks(READER_NOTES),
    readerBlock('business', model, ctx, file, headings),
    readerBlock('developer', model, ctx, file, headings),
    unplaced(model, ctx, headings),
  ]);
}

/** 拡張候補の節の中身(台帳と検証の結果が渡されていなければ空)。 */
function candidates(ctx: GenerateContext): Child[] {
  if (ctx.extensionLedger === undefined) return [];
  const rows = extensionHits(ctx);
  if (rows === null) return [el('p', null, CANDIDATES_UNREADABLE)];
  if (rows.length === 0) return [el('p', null, CANDIDATES_NONE)];
  const total = rows.reduce((sum, row) => sum + row.hits.length, 0);
  return [
    el('p', null, candidatesLead(rows.length, total)),
    table(
      [...CANDIDATE_HEADERS],
      candidateRows(rows, ctx.roots).map((row) => [
        mono(row.id),
        inline(row.statement),
        row.status,
        inline(row.rules),
        row.count,
        row.places.length === 0 ? '—' : join(row.places.map((place) => el('div', null, inline(place)))),
      ]),
    ),
  ];
}

/** 未分類の警告の節の中身(台帳が渡されていなければ空)。 */
function unclassified(ctx: GenerateContext): Child[] {
  if (ctx.extensionLedger === undefined) return [];
  const pending = pendingFindings(ctx);
  if (pending === null) return [el('p', null, UNCLASSIFIED_UNCOUNTED)];
  if (pending.length === 0) return [el('p', null, UNCLASSIFIED_NONE)];
  return [el('p', null, unclassifiedLead(pending.length)), pts(unclassifiedLines(pending, ctx.roots).map((line) => join([mono(line.id), ' ', line.what, `(${line.where})`])))];
}

/** 「警告の区分」の節(見出しと定型の説明は常に出し、台帳と警告に依る中身だけを印の中に置く)。 */
export function extensionSection(ctx: GenerateContext, headings: PageHeading[]): Html {
  return section('extension', EXTENSION_HEADING, headings, () => [
    noteBlocks(EXTENSION_INTRO),
    sub('extension-candidates', EXTENSION_CANDIDATES_HEADING, headings),
    verified(candidates(ctx), true),
    sub('extension-unclassified', EXTENSION_UNCLASSIFIED_HEADING, headings),
    verified(unclassified(ctx), true),
  ]);
}
