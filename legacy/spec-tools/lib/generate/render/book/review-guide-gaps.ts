/**
 * レビューの手引きの「人が書く文の未記入」の節。
 *
 * 人が書く文(`summary:`)は書かなくても仕様は通る(検査を error にすると、状態を 1 つ足す作業が文章を書く作業に
 * なる)。そのかわり**書かれていない場所を章に「(まだ書かれていない)」と出し、手引きが章ごとの数を配る**。
 * 手引きの「流し読みで良い」「未分類」と同じ設計で、**数えていない**と**数えて 0 だった**を見分けられるようにする。
 * 数は仕様から数える(`summary-gaps.ts`)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { markdownTable } from '../../../gen-kit/state-machine-table.js';
import { bookChapters, bookFile } from './chapters.js';
import { gapTotal, summaryGapsOf } from './summary-gaps.js';

/** 節の題と見出し行。 */
export const GAP_HEADING = '人が書く文の未記入';
export const GAP_HEADERS = ['章', '章頭', '節の要約', '段の場面', '未記入', '記入済み / 場所'] as const;

/** 節の箇条(未記入の件数と書く場所の数が最後の 1 行に入る)。 */
export function gapNotes(total: number, places: number): readonly string[] {
  return [
    '- 章頭の 1 文・節の要約・段の場面は、人が仕様の `summary` に書く(書き方は domain-spec-writing.md の summary の節)',
    '- 書かれていない場所は、章に「(まだ書かれていない)」と出る。書かなくても仕様の検査は通る',
    '- 文の語と文体は検査が見る(語の接地は M10、文体は M12)。文が仕様と同じことを言っているかは人が読んで確かめる',
    `- いまの未記入は全章で ${total} 件(書く場所は ${places} か所)`,
  ];
}

/** 章 1 つの行(数は字。章頭・節の要約・段の場面・未記入・記入済み / 場所)。 */
export interface GapRow {
  readonly file: string;
  readonly title: string;
  readonly entity: string;
  readonly machines: string;
  readonly states: string;
  readonly total: string;
  readonly written: string;
}

/** 節のデータ(章ごとの行と全章の合計)。 */
export interface GapData {
  readonly total: number;
  readonly places: number;
  readonly rows: readonly GapRow[];
}

/**
 * 「人が書く文の未記入」の数を章ごとに数える。従属する集約は親の章の節に出るので、親の章の数に入る。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 */
export function gapData(model: SpecModel, ctx: GenerateContext): GapData {
  const chapters = bookChapters(model, ctx)
    .filter((chapter) => chapter.aggregate !== undefined)
    .map((chapter) => {
      const names = [chapter.aggregate ?? '', ...(chapter.folded ?? [])];
      const scope = names.flatMap((name) => model.aggregates.get(name) ?? []);
      return { chapter, gaps: summaryGapsOf(scope) };
    });
  return {
    total: chapters.reduce((sum, chapter) => sum + gapTotal(chapter.gaps), 0),
    places: chapters.reduce((sum, chapter) => sum + chapter.gaps.places, 0),
    rows: chapters.map(({ chapter, gaps }) => ({
      file: chapter.file,
      title: chapter.title,
      entity: String(gaps.entity),
      machines: String(gaps.machines),
      states: String(gaps.states),
      total: String(gapTotal(gaps)),
      written: `${gaps.places - gapTotal(gaps)} / ${gaps.places}`,
    })),
  };
}

/**
 * 「人が書く文の未記入」の節を組み立てる。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 */
export function gapSection(model: SpecModel, ctx: GenerateContext): string[] {
  const data = gapData(model, ctx);
  return [
    `## ${GAP_HEADING}`,
    gapNotes(data.total, data.places).join('\n'),
    markdownTable(
      [...GAP_HEADERS],
      data.rows.map((entry) => [
        `[${entry.title}](./${entry.file.slice(bookFile(ctx.roots).length + 1)})`,
        entry.entity,
        entry.machines,
        entry.states,
        `**${entry.total}**`,
        entry.written,
      ]),
    ),
  ];
}
