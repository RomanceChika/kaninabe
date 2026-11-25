/**
 * 「レビューの手引き」の章の HTML 版。
 *
 * 中身は `review-guide.ts` / `review-guide-reading.ts` / `review-guide-gaps.ts` / `review-guide-extension.ts` の事実と語で、並びは:
 * 導入 → タスクから読む → どの章を読むか → 読む量 → 警告の区分 → 人が書く文の未記入 → ブロックごとの数。
 * この章は層の章の骨格を持たないので、共有の部品で節と表を組む。表の行と定型の文は上の各ファイルが export したものを使う(文は `inline` で読む)。
 * 各章へのリンクは書き出した本の章へ繋ぐ(`chapterHref`)。まだ HTML に移していない章は題だけを字にする。
 *
 * 数が検証の結果に依る部分(読む量の必読・受け入れ・表の行、警告の区分、一覧の「必読 0」の添え書き)は `verified` の印を付ける
 * (読む量と警告の区分の節は `review-guide-reading-chapter.ts`)。
 *
 * 「警告の区分」の節は常に出す(目次が台帳の有無によらず同じになるよう、中身だけを印の中に置く)。
 * 導入の「ハンドブック」へのリンクは表紙(`index.html`)を指す。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { bookFile, relativeHref } from '../chapters.js';
import { chapterLoads, type ChapterLoad } from '../chapter-loads.js';
import {
  BLOCK_HEADERS,
  BLOCK_HEADING,
  BLOCK_LEAD,
  CHAPTER_HEADING,
  GUIDE_TITLE,
  HEADER_INDEX,
  HEADER_LEAD,
  HEADER_POINTS,
  HEADER_UNITS,
  PLAYBOOK_FILE,
  ZERO_REQUIRED_NOTE,
  blockRows,
  chapterVerdict,
  readsInAggregates,
} from '../review-guide.js';
import { TASK_HEADING, TASK_INTRO, taskLines } from '../review-guide-tasks.js';
import { GAP_HEADERS, GAP_HEADING, gapData, gapNotes } from '../review-guide-gaps.js';
import { section, segments, table, type ChapterBody } from './chapter-parts.js';
import { bold, inline, pts, verified } from './face-parts.js';
import { noteBlocks } from './folded-table.js';
import { chapterHref } from './index-chapter.js';
import { el, join, url, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';
import { extensionSection, readingSection } from './review-guide-reading-chapter.js';

/** 章の題。 */
export const REVIEW_GUIDE_TITLE = GUIDE_TITLE;

/** 章へのリンク(まだ HTML に移していない章は題だけ)。 */
function chapterLink(model: SpecModel, ctx: GenerateContext, chapterFile: string, title: string): Child {
  const href = chapterHref(model, ctx, chapterFile);
  return href === null ? title : el('a', { href: url(href) }, title);
}

/** 「タスクから読む」の節(タスクをまだ仕様化していない環境では出さない)。 */
function taskSection(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Html | null {
  const found = taskLines(model, ctx);
  if (found === null) return null;
  const hrefOf = (to: string): string | null => chapterHref(model, ctx, bookFile(ctx.roots, `${to}.md`));
  return section('tasks', TASK_HEADING, headings, () => [
    el('p', null, segments(TASK_INTRO, hrefOf)),
    pts(found.map((line) => join([bold(line.goal), ' — 画面: ', inline(line.screens), ' / 操作: ', inline(line.ops)]))),
  ]);
}

/** 「どの章を読むか」の節(章 1 つが 1 行)。 */
function chapterList(model: SpecModel, ctx: GenerateContext, loads: readonly ChapterLoad[], headings: PageHeading[]): Html {
  return section('chapters', CHAPTER_HEADING, headings, () =>
    pts(
      loads.map((load) => {
        const verdict = chapterVerdict(load);
        return join([
          chapterLink(model, ctx, load.chapter.file, load.chapter.title),
          ' — ',
          inline(verdict.text),
          // 必読 0 の添え書きは検証の結果に依る(入口は引けないので書かない)。印の要素は両方の出力に置く。
          verdict.counted ? verified(readsInAggregates(load, model, ctx) ? [ZERO_REQUIRED_NOTE] : []) : null,
        ]);
      }),
    ),
  );
}

/** 「人が書く文の未記入」の節。 */
function gapSection(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Html {
  const data = gapData(model, ctx);
  return section('gaps', GAP_HEADING, headings, () => [
    noteBlocks(gapNotes(data.total, data.places)),
    table(
      [...GAP_HEADERS],
      data.rows.map((row) => [chapterLink(model, ctx, row.file, row.title), row.entity, row.machines, row.states, bold(row.total), row.written]),
    ),
  ]);
}

/** 「ブロックごとの数」の節(章ごとの小見出しと表)。 */
function blockSection(model: SpecModel, ctx: GenerateContext, loads: readonly ChapterLoad[], file: string, headings: PageHeading[]): Html | null {
  const chapters = loads.filter((load) => load.blocks.length > 0);
  if (chapters.length === 0) return null;
  return section('blocks', BLOCK_HEADING, headings, () => [
    el('p', null, inline(BLOCK_LEAD)),
    chapters.map((load, index) => {
      const id = `blocks-${index + 1}`;
      headings.push({ level: 3, id, title: el('span', null, load.chapter.title) });
      return [
        el('h3', { id }, chapterLink(model, ctx, load.chapter.file, load.chapter.title)),
        table(
          [...BLOCK_HEADERS],
          blockRows(load, ctx.roots).map((row) => [
            row.section,
            row.file === null ? row.shown : el('a', { href: url(relativeHref(file, row.file)) }, row.shown),
            row.signs,
            row.decls,
            row.breakdown ?? '—',
          ]),
        ),
      ];
    }),
  ]);
}

/**
 * レビューの手引きの章の本文と目次。
 *
 * @param file 書き出すファイル(リポジトリルート相対。出典へのリンクの起点)
 */
export function reviewGuideChapter(model: SpecModel, ctx: GenerateContext, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const loads = chapterLoads(model, ctx);
  const hrefOf = (to: string): string | null => (to === 'handbook' ? './index.html' : relativeHref(file, PLAYBOOK_FILE));
  const body = join([
    el('h1', null, GUIDE_TITLE),
    el('p', null, segments(HEADER_LEAD, hrefOf)),
    noteBlocks(HEADER_POINTS),
    el('p', null, inline(HEADER_UNITS)),
    el('p', null, segments(HEADER_INDEX, hrefOf)),
    taskSection(model, ctx, headings),
    chapterList(model, ctx, loads, headings),
    readingSection(model, ctx, file, headings),
    extensionSection(ctx, headings),
    gapSection(model, ctx, headings),
    blockSection(model, ctx, loads, file, headings),
  ]);
  return { body, headings };
}
