/**
 * 「タスク — この人はこれを 1 分でできるか」の章の HTML 版。
 *
 * 中身は `usecases-page.ts` / `face-tasks.ts` / `results-section.ts`(保存点の結果表)の事実と語で、並びは:
 * 章の頭の 1 行 → 導入 → パンくず → 読む量の 4 枚 → タスクごとの節(物語 → 数えた面倒 → 結果表 → 保存点では立たないロール → 応答 → 標識)。
 * この章は層の章の骨格(上段/下段)を持たないので、`layer-chapter.ts` は使わず、共有の部品で節と表を組む。
 * 表の行と定型の文は `usecases-page.ts` が export したものを使う(文は `inline` で読む)。結果表は保存点ごとの折りたたみ(`FoldedTable`)で、行は `results-section.ts` のもの。
 *
 * 数が検証の結果に依る部分(読む量の 4 枚のうち必読と受け入れ。まだ通していない警告を含む)は `verified` の印を付ける。
 *
 * 読む量の 4 枚と折りたたみは、人向けの表示の宣言(`humanFaceChapters`)によらず常に出す。標識の引用は本文に並べず、タスクごとの折りたたみ(`signFold`)に入れる。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { UsecaseSpec, UsecaseSpecModel } from '../../../../model/usecase/types.js';
import type { SaveResult } from '../../../../results/save-cases.js';
import { saveResults } from '../../../../results/save-cases.js';
import { deriveUsecaseMetrics } from '../../../../usecase/derive-effort.js';
import { RESULT_WORDS } from '../../../../messages/messages-results.js';
import { gatesBlocked } from '../../../../relations/screen-reachability/index.js';
import { specPath } from '../../../../model/product/paths.js';
import { headingSlug } from '../../html.js';
import { chapterReading, requiredOf, type ReadingSum } from '../block-reading.js';
import { acceptOf, pendingWords, readerLines } from '../face-budget.js';
import { AXIOM_NOTE_BOLD, CHANGED_NOTE, READER_NOTES, axiomNoteTail, deriveLines } from '../face-tasks.js';
import { resultLabelsOf, saveResultTable } from '../results-section.js';
import {
  BUDGET_HEADERS,
  BUDGET_HEADING,
  LEAD,
  RESULT_HEADING,
  UNRESOLVABLE_HEADERS,
  UNRESOLVABLE_HEADING,
  UNRESOLVABLE_LEAD,
  USECASES_TITLE,
  asyncLine,
  budgetRows,
  entityOf,
  sortedUsecases,
  storyText,
  unresolvableRows,
  usecaseInputOf,
} from '../usecases-page.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { countLine } from './count-line.js';
import { foldedTable } from './folded-table.js';
import { bold, grid, inline, mono, pts } from './face-parts.js';
import { signFold } from './layer-chapter.js';
import { el, join, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { USECASES_TITLE };

/** 共有の文(Markdown の記法を含む)で組んだ表。 */
function sharedTable(headers: readonly string[], rows: readonly (readonly string[])[]): Child {
  return table(
    headers,
    rows.map((row) => row.map((value) => inline(value))),
  );
}

/** 読む量の 4 枚(数は章のブロックを足したもの。必読と受け入れは検証の結果に依る)。 */
function budget(sum: ReadingSum, cases: number): Html {
  const { business, developer } = sum.byReader;
  return grid([
    {
      id: 'axiom',
      label: '必読',
      mark: 'axiom',
      value: `業務 ${requiredOf(business)} / 開発者 ${requiredOf(developer)}`,
      verify: true,
      body: [pts([...readerLines(sum, READER_NOTES), join([bold(AXIOM_NOTE_BOLD), axiomNoteTail(sum)])])],
    },
    {
      id: 'changed',
      label: '今回変わった',
      mark: 'changed',
      value: sum.changed === null ? '—' : String(sum.changed),
      body: [
        sum.changed === null
          ? pts(['基点が無いので数えない', join(['基点は ', mono('generate -- --base'), ' で渡す'])])
          : pts([`公理の側の動き ${sum.changed} か所`, CHANGED_NOTE]),
      ],
    },
    {
      id: 'acceptance',
      label: '受け入れ',
      mark: 'acceptance',
      value: String(acceptOf(business) + acceptOf(developer)),
      verify: true,
      body: [pts([`理由をつけて通した分 ${sum.reasoned} 件`, pendingWords(sum.pending)])],
    },
    { id: 'derive', label: '参照', mark: 'derive', value: String(cases), body: [pts(deriveLines(cases))] },
  ]);
}

/** 保存点ごとの結果表(world を作れない保存点は理由の 1 行)。 */
function saveFolds(model: SpecModel, ctx: GenerateContext, found: readonly SaveResult[]): Child[] {
  return found.map((save) => {
    const entry = saveResultTable(save, resultLabelsOf(model, ctx, entityOf(save)), ctx.roots);
    return entry === null ? el('p', null, bold(save.label), ' — ', inline(RESULT_WORDS.noProof(save.problems.join(' / ')))) : foldedTable(entry);
  });
}

/** 1 タスクの節の中身(物語 → 数えた面倒 → 結果表 → 保存点では立たないロール → 応答 → 標識)。 */
function usecaseBody(
  usecase: UsecaseSpec,
  id: string,
  context: { readonly model: SpecModel; readonly ctx: GenerateContext; readonly usecases: UsecaseSpecModel; readonly results: readonly SaveResult[]; readonly file: string },
  headings: PageHeading[],
): Child[] {
  const { model, ctx, usecases, results, file } = context;
  const input = usecaseInputOf(model, ctx, usecases);
  const metrics = deriveUsecaseMetrics(usecase, input);
  const sub = (suffix: string, title: string): Html => {
    headings.push({ level: 3, id: `${id}-${suffix}`, title: el('span', null, title) });
    return el('h3', { id: `${id}-${suffix}` }, title);
  };
  const found = results.filter((save) => save.usecase === usecase.name);
  const unresolvable = unresolvableRows(usecase, model, ctx);
  return [
    el('p', null, inline(storyText(usecase))),
    sub('budget', BUDGET_HEADING),
    sharedTable(BUDGET_HEADERS, budgetRows(usecase, metrics, input.budgetDefaults, gatesBlocked(input.gates))),
    found.length === 0 ? null : [sub('results', RESULT_HEADING), el('p', null, inline(RESULT_WORDS.saveChapterNote)), saveFolds(model, ctx, found)],
    unresolvable.length === 0 ? null : [sub('unresolvable', UNRESOLVABLE_HEADING), el('p', null, inline(UNRESOLVABLE_LEAD)), sharedTable(UNRESOLVABLE_HEADERS, unresolvable)],
    metrics.asyncOps.length === 0 ? null : el('p', null, inline(asyncLine(metrics.asyncOps))),
    signFold(specPath(ctx.roots, `frontend/usecases/${usecase.relPath}`), ctx, file),
  ];
}

/**
 * タスクの章の本文と目次。
 *
 * @param usecases 読み込み済みのユースケース仕様
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function usecasesChapter(model: SpecModel, ctx: GenerateContext, usecases: UsecaseSpecModel, countKey: string, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const sorted = sortedUsecases(usecases);
  const results = saveResults({ domain: model, guards: ctx.guards, actions: ctx.actions, dataTables: ctx.dataTables, usecases });
  const cases = results.reduce((total, save) => total + save.count, 0);
  const product = ctx.roots.name === null ? '' : `${ctx.roots.name} `;
  const body = join([
    el('h1', null, USECASES_TITLE),
    countLine(model, ctx, countKey),
    el('p', null, inline(LEAD)),
    el('p', { class: 'bf-note' }, `${product}ハンドブック · タスクの章 · タスクは ${sorted.length} 本`),
    budget(chapterReading(model, ctx, countKey), cases),
    sorted.map((usecase, index) => {
      const id = `usecase-${headingSlug(usecase.name) || index + 1}`;
      return section(id, usecase.goal, headings, () => usecaseBody(usecase, id, { model, ctx, usecases, results, file }, headings));
    }),
  ]);
  return { body, headings };
}
