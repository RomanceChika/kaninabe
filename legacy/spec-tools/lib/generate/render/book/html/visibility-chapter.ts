/**
 * 「誰に何が見えるか」の章の HTML 版。
 *
 * 中身は `visibility-page.ts` / `visibility-lower.ts` / `visibility-open-writes.ts` の事実と語で、骨格は `layer-chapter.ts`。
 * **この章に公理は無い**(アクセスの宣言は集約の章が数える)。上段は「集約の章で読む」の案内の表だけで、横断の表・未ログインに開いた書き込み・
 * 個人データ・読み取り経路・索引は下段に折りたたむ。表の行と前書きは共有のもの(`FoldedTable`)を使う。
 *
 * 案内の表の章は、HTML の本の中の章へ繋ぐ(集約の章は `spec/{集約}.html`)。まだ移していない章は題だけを出す。
 * 表紙へのリンクは `index.html`。外部連携の章への Markdown リンクは、移していないので題だけの字にする。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { collectSigns } from '../../../prose.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { crossReferenceRows, signSources } from '../visibility-page.js';
import { visibilityLower } from '../visibility-lower.js';
import { foldedTable } from './folded-table.js';
import { bold, mono, pts } from './face-parts.js';
import { chapterHref } from './index-chapter.js';
import { items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, url, type Child } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const VISIBILITY_TITLE = '誰に何が見えるか';

/**
 * 可視性の章の本文と目次。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function visibilityChapter(model: SpecModel, ctx: GenerateContext, countKey: string, file: string): ChapterBody {
  const all = pendingFindings(ctx);
  const sources = signSources(ctx);
  const lower = visibilityLower(model, ctx);
  const cross = crossReferenceRows(model, ctx);
  const queries = ctx.queries?.queries.length ?? 0;
  const upper = (outline: Outline): Child[] => [
    outline.h3('read-in-aggregates', `集約の章で読む(${cross.rows.length})`),
    cross.rows.length === 0
      ? pts(['アクセスの宣言を持つ集約は、まだ無い'])
      : table(
          ['集約の章', '仕様ファイル', '数えている公理'],
          cross.rows.map((row) => {
            const href = chapterHref(model, ctx, row.chapter);
            return [href === null ? row.title : el('a', { href: url(href) }, row.title), mono(specRelative(row.file, ctx)), String(row.axioms)];
          }),
        ),
  ];
  return layerChapter(model, ctx, {
    title: VISIBILITY_TITLE,
    countKey,
    file,
    crumb: { layer: '可視性の章', count: `読み取り経路は ${queries} 本` },
    intro: [
      '誰に何が見えるかは、集約ごとのアクセスの宣言が決める',
      'この章は、その宣言を全集約から集めて、横断で読む場所',
      '宣言そのものは集約の章が必読に数える。この章に公理は無い',
      '同じ宣言を二度必読に数えないため',
      join(['ロールの一覧は', el('a', { href: url('./index.html') }, '表紙'), 'にある']),
    ],
    axiomBreakdown: `アクセスの宣言 ${cross.total} 本は、集約の章が数える`,
    upperBullets: [
      'この章に公理は無い',
      'アクセスの宣言は、集約の章の「誰に見えるか」で読む',
      '下の表は、その案内。手引きと同じ集計から引いた数',
      '「このロールに、このデータが、この範囲で見えるのは正しいか」は、集約の章で判定する',
    ],
    upper,
    accept: {
      groups: [],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: sources.reduce((sum, source) => sum + collectSigns(ctx.specSources?.get(source) ?? '').length, 0),
      signFiles: sources,
      signPlaces: '読み取り経路と、ロールと、外から届く surface の仕様',
    },
    reasonedWords: '可視性の宣言の受け入れは集約の章が数える。この章に、理由を書く欄は無い',
    lower: lower.tables.map(foldedTable),
    derived: {
      count: lower.count,
      lines: [
        `横断の表 ${lower.rows.matrix} 行、未ログインに開いた書き込み ${lower.rows.open} 行、個人データの表 ${lower.rows.personal} 行、読み取り経路 ${lower.rows.queries} 行、索引 ${lower.rows.index} 行`,
        'どれも集約の章の宣言から機械が出した表',
      ],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['アクセスの宣言は集約ごとのファイルにあり、', mono('domain/*/access.md'), ' が正']),
          `読み取り経路 ${queries} 本の仕様、ロール、外から届く surface の仕様の標識を、受け入れの下に置く`,
          bold('この章で「全部」と言うのは、横断の表に並ぶ宣言だけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          bold('この章は公理を数えない'),
          `アクセスの宣言 ${cross.total} 本は、集約の章の「誰に見えるか」が数える。同じ宣言を二度必読に数えない`,
          '二重に数えない判定は、手引きと同じ集計(ブロック)から機械が引く',
          '読み取り経路・個人データ・索引は導出で、下段の表に出す',
        ]),
      ],
    ],
  });
}
