/**
 * 「UX 原則」の章の HTML 版。
 *
 * 中身は `ux-principles-page.ts` の事実と語で、並びは: 章の頭の 1 行 → 導入 → 原則・見張る検査・閾値の表(+ 閾値の読み方)→ 画面ごとの受け入れ → 標識。
 * この章は層の章の骨格を持たないので、共有の部品で節と表を組む。表の行と定型の文は `ux-principles-page.ts` が export したものを使う(文は `inline` で読む)。
 *
 * 標識の引用は本文に並べず折りたたみ(`signFold`)に入れる。受け入れの表の画面名は、仕様ファイルへの同じ相対パスのリンク。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { UxPrinciplesSpec } from '../../../../model/ux-principles/types.js';
import { BUDGET_NOTE, LEAD, UX_TITLE, UX_WORDS, acceptanceFacts, acceptanceLead, principleRows, screenSpecFile } from '../ux-principles-page.js';
import { relativeHref } from '../chapters.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { countLine } from './count-line.js';
import { inline } from './face-parts.js';
import { signFold } from './layer-chapter.js';
import { el, join, url, type Child } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { UX_TITLE };

/** 原則の節(表 + 閾値の読み方)。 */
function principleBody(spec: UxPrinciplesSpec): Child {
  if (spec.principles.length === 0) return [el('p', null, UX_WORDS.noPrinciples), el('p', null, inline(BUDGET_NOTE))];
  return [
    table(
      UX_WORDS.principleHeaders,
      principleRows(spec).map((row) => row.map((value) => inline(value))),
    ),
    el('p', null, inline(BUDGET_NOTE)),
  ];
}

/** 受け入れの節(件数の 1 行 + 表)。 */
function acceptanceBody(ctx: GenerateContext, file: string): Child {
  const facts = acceptanceFacts(ctx.screens?.screens ?? []);
  if (facts === null) return el('p', null, UX_WORDS.noAccept);
  return [
    el('p', null, inline(acceptanceLead(facts))),
    table(
      UX_WORDS.acceptHeaders,
      facts.rows.map(({ screen, cells }) => [
        el('a', { href: url(relativeHref(file, screenSpecFile(ctx.roots, screen))) }, screen.name),
        ...cells.slice(1).map((value) => inline(value)),
      ]),
    ),
  ];
}

/**
 * UX 原則の章の本文と目次。
 *
 * @param spec 読み込み済みの UX 原則の台帳
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function uxPrinciplesChapter(model: SpecModel, ctx: GenerateContext, spec: UxPrinciplesSpec, countKey: string, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const body = join([
    el('h1', null, UX_TITLE),
    countLine(model, ctx, countKey),
    el('p', null, inline(LEAD)),
    section('principles', UX_WORDS.principles, headings, () => principleBody(spec)),
    section('exceptions', UX_WORDS.accept, headings, () => acceptanceBody(ctx, file)),
    signFold(spec.location.file, ctx, file),
  ]);
  return { body, headings };
}
