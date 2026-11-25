/**
 * 「誰が何を実行できるか(操作)」の章の HTML 版。
 *
 * 中身は `actions-page.ts` / `actions-lower.ts` の事実と語で、骨格は `layer-chapter.ts`。
 * **この章に公理も受け入れも数えない**(操作の宣言は集約の章、理由は集約の章と表の章が数える)。上段は「他の章で数えているもの」の案内の表だけ。
 * 下段は集約ごとの操作の表と操作ごとの結果表、例外の一覧(生成に乗らない操作・手書きの RPC・入口の無い操作)。表の行と前書きは `actions-lower.ts` のものを使う。
 *
 * 案内の表の章は、HTML の本の中の章へ繋ぐ(まだ移していない章は題だけ)。属性・方針の読み方の末尾にある
 * 規約(`action-spec-writing.md`)への Markdown リンクは、HTML の本から生の Markdown へ繋がない決まりなので、題だけの字にする。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { ActionSpecModel } from '../../../../model/trace/types.js';
import { RESULT_WORDS } from '../../../../messages/messages-results.js';
import { resultAggregates } from '../../../../results/cases.js';
import { buildActionRows } from '../../actions-view.js';
import { ATTRIBUTES_NOTE, countedElsewhere, type CountedElsewhereRow } from '../actions-page.js';
import { actionsLower, type ActionsLowerGroup } from '../actions-lower.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { foldedTable, noteBlocks } from './folded-table.js';
import { bold, mono, pts } from './face-parts.js';
import { chapterHref } from './index-chapter.js';
import { items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, url, type Child } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const ACTIONS_TITLE = '誰が何を実行できるか(操作)';

/** 「数えている章」の欄(章ごとに「題 N 件」を「、」でつなぐ)。 */
function whereCell(model: SpecModel, ctx: GenerateContext, row: CountedElsewhereRow): Child[] {
  return row.chapters.flatMap((entry, index): Child[] => {
    const href = entry.chapter === '' ? null : chapterHref(model, ctx, entry.chapter);
    const title: Child = entry.chapter === '' ? '章に配れない' : href === null ? entry.title : el('a', { href: url(href) }, entry.title);
    return [index === 0 ? null : '、', title, ` ${entry.count} 件`];
  });
}

/** 集約 1 つぶんの下段(見出しの段落・操作の表・理由の 1 行・操作ごとの結果表)。 */
function groupHtml(group: ActionsLowerGroup): Child[] {
  return [
    el('p', { class: 'bf-group' }, group.title, el('small', null, `操作 ${group.operations.rows.length} 本`)),
    foldedTable(group.operations),
    group.missing === null ? null : noteBlocks([group.missing]),
    group.results.map(foldedTable),
  ];
}

/**
 * 操作の章の本文と目次。
 *
 * @param actions 読み込み済みの action_spec 一式
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function actionsChapter(model: SpecModel, ctx: GenerateContext, actions: ActionSpecModel, countKey: string, file: string): ChapterBody {
  const rows = buildActionRows(model, actions, ctx);
  const results = resultAggregates({ domain: model, guards: ctx.guards, actions: ctx.actions, dataTables: ctx.dataTables, jobs: ctx.jobs });
  const all = pendingFindings(ctx);
  const lower = actionsLower(model, ctx, rows, results, actions);
  const elsewhere = countedElsewhere(model, ctx, countKey);
  const upper = (outline: Outline): Child[] => [
    outline.h3('counted-elsewhere', `他の章で数えているもの(${elsewhere.rows.length})`),
    elsewhere.rows.length === 0
      ? pts(['他の章が受け入れとして数えている、操作に関わる理由は無い'])
      : table(
          ['理由の種類', '件数', '数えている章'],
          elsewhere.rows.map((row) => [row.name, String(row.count), whereCell(model, ctx, row)]),
        ),
  ];
  return layerChapter(model, ctx, {
    title: ACTIONS_TITLE,
    countKey,
    file,
    crumb: { layer: '操作の章', count: `操作は ${rows.length} 本` },
    intro: [
      '書き込みの入口は、この一覧に載っている操作が全部',
      join([mono('verify'), ' の A4 が、人間ロールが実行できる全イベントに、入口か免除の宣言があることを見る']),
      '集約ごとに、何をするか、誰が実行できるか、入力、起きること、テストを 1 行にする',
      '結果表は、誰がどの状態のものを動かせるかと、どういう場合に落ちるかを、結末で並べた表',
      '操作の宣言は集約の章が数える。この章に公理は無い',
    ],
    axiomBreakdown: '操作の宣言と、操作に関わる理由は、集約の章が数える',
    upperBullets: [
      'この章に公理は無い',
      '操作の宣言は、集約の章の「操作」で読む',
      '確認の上書き、生成に乗らない理由、手書きの理由は、集約の章と表の章の受け入れが数える',
      '下の表は、その案内。手引きと同じ割り付けから引いた数',
    ],
    upper,
    accept: {
      groups: [],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: 0,
      signFiles: [],
      signPlaces: '操作の仕様',
    },
    reasonedWords: '操作に関わる理由は、集約の章と表の章の受け入れが数える。この章に、理由を書く欄は無い',
    lower: [
      noteBlocks([ATTRIBUTES_NOTE, RESULT_WORDS.chapterNote]),
      lower.groups.map(groupHtml),
      el('p', { class: 'bf-group' }, '例外の一覧(再掲)', el('small', null, '理由は集約の章と表の章の受け入れが数える')),
      lower.exceptions.map(foldedTable),
    ],
    derived: {
      count: lower.count,
      lines: [
        `操作の表 ${lower.rows.operations} 行、結果表 ${lower.rows.results} 行`,
        `生成に乗らない操作 ${lower.rows.manual} 行、手書きの RPC ${lower.rows.handwritten} 行、入口の無い操作 ${lower.rows.unhandled} 行`,
        '例外の一覧は、他の章の受け入れの再掲',
      ],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          `操作 ${rows.length} 本(action_spec の全部)`,
          join([`入口の無い操作 ${actions.unhandled.length} 件(`, mono('README.md'), ' の ', mono('unhandled'), ')']),
          bold('この章で「全部」と言うのは、この一覧に載っている操作だけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          bold('この章は公理も受け入れも数えない'),
          `他の章が数えている理由 ${elsewhere.total} 件のうち、この章に配られるのは ${elsewhere.here} 件`,
          '二重に数えない判定は、手引きと同じ割り付け(ブロック)から機械が引く',
          '操作の表・結果表・例外の一覧は導出で、下段の表に出す',
        ]),
      ],
    ],
  });
}
