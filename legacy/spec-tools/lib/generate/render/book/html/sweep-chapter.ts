/**
 * 「一通り試すとは何か(L2 網羅台帳)」の章の HTML 版。
 *
 * 中身は `sweep-page.ts` の事実と語で、並びは: 導入 → 6 つのグループの表(状態遷移・状態・画面 × 操作・読み取り経路・通知・ジョブ)→ 読み取り経路と通知・ジョブの注 → 押さえるテストが 1 本も無い行の一覧。
 * この章は層の章の骨格を持たない(標識も数えない)ので、共有の部品で節と表を組む。表の行と定型の文は `sweep-page.ts` が export したものを使う(文は `inline` で読む)。
 * 節の見出しに目次用の `id` を持つ。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { buildL2SweepRows, rowsWithoutEvidence } from '../../l2-sweep.js';
import type { L2Section } from '../../l2-sweep.js';
import { CATALOG_NOTE, LEAD, QUERY_NOTE, SECTIONS, SWEEP_WORDS, TAIL_LEAD, sectionTable, tailLine } from '../sweep-page.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { inline, pts } from './face-parts.js';
import { el, join } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export const SWEEP_TITLE = SWEEP_WORDS.title;

/** グループの節の `id`(目次の鍵。見出しの字は日本語なので ASCII で持つ)。 */
const SECTION_IDS: Readonly<Record<L2Section, string>> = {
  状態遷移: 'transitions',
  状態: 'states',
  '画面 × 操作': 'screens',
  読み取り経路: 'queries',
  通知: 'notifications',
  ジョブ: 'jobs',
};

/**
 * 網羅台帳の章の本文と目次。
 */
export function sweepChapter(model: SpecModel, ctx: GenerateContext): ChapterBody {
  const headings: PageHeading[] = [];
  const rows = buildL2SweepRows(model, ctx);
  const missing = rowsWithoutEvidence(rows);
  const body = join([
    el('h1', null, SWEEP_TITLE),
    el('p', null, inline(LEAD)),
    SECTIONS.map((name) =>
      section(SECTION_IDS[name], name, headings, () => {
        const grouped = sectionTable(name, rows);
        return grouped === null
          ? el('p', null, SWEEP_WORDS.empty)
          : table(
              grouped.headers,
              grouped.rows.map((row) => row.map((value) => inline(value))),
            );
      }),
    ),
    el('p', null, inline(QUERY_NOTE)),
    el('p', null, inline(CATALOG_NOTE)),
    section('tail', SWEEP_WORDS.tail, headings, () => [
      el('p', null, inline(TAIL_LEAD)),
      missing.length === 0 ? el('p', null, SWEEP_WORDS.tailNone) : pts(missing.map((row) => tailLine(row))),
    ]),
  ]);
  return { body, headings };
}
