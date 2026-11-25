/**
 * 「デザイン」の章の HTML 版。
 *
 * 中身は `design-page.ts` の事実と語で、並びは: 章の頭の 1 行 → 導入 → ロゴ → テーマのトークン(トークン一覧・コントラスト検査)→ パーツ見本 → 標識。
 * この章は層の章の骨格を持たないので、共有の部品で節と表を組む。トークンの行・コントラストの実比・パーツ見本の部品名とトークン名は、
 * 共有の集計(`token-tables.ts` / `parts-demo.ts`)の事実をそのまま使う。
 *
 * 出力の口 `markup.ts` が `style` 属性と生の HTML を持たないので:
 * - 色トークンのスウォッチ(CSS 変数を引く `<span style>`)は描かない。トークン名と値(hex)を等幅の字で出す。
 * - パーツ見本(実 CSS で描いた静的な HTML)は描かない。見本ごとの部品名と使うトークン名の表、状態バッジの対応(状態・表示名・意味色)の表、見本に未掲載のクラスの注に置き換える。
 * - テーマの節の見出しは、テーマ名を等幅にしない(見出しは字だけ)。
 * 標識の引用は本文に並べず折りたたみ(`signFold`)に入れる。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { DesignTokenSpec } from '../../../../model/design/types.js';
import type { ProductRoots } from '../../../../model/product/types.js';
import { CONTRAST_HEADERS, CONTRAST_HEADING, TOKEN_HEADERS, TOKEN_LIST_HEADING, contrastFacts, tokenFacts } from '../../token-tables.js';
import { brandIconFact, type BrandIconFact } from '../brand-icon.js';
import { DESIGN_TITLE, DESIGN_WORDS, LEAD, logoUnembedded, themeHeading } from '../design-page.js';
import { UNAVAILABLE, UNCOVERED_LEAD, partsDemoFacts, type PartsDemoFacts } from '../parts-demo.js';
import { section, table, type ChapterBody } from './chapter-parts.js';
import { countLine } from './count-line.js';
import { bold, dash, inline, mono } from './face-parts.js';
import { signFold } from './layer-chapter.js';
import { el, join, previewFragment, text, url, type Child, type Html } from './markup.js';
import { previewRefused } from './preview-refusal.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { DESIGN_TITLE };

/** この HTML 版がパーツ見本を表で写すことの注(定型。HTML の本の語)。 */
/** ロゴの画像(仮のアイコンなら「(仮)」を添える)。 */
function logoImage(fact: BrandIconFact): Child[] {
  return [el('img', { src: url(fact.src), alt: 'ロゴ', width: 40, height: 40 }), fact.provisional ? el('sup', null, '(仮)') : null];
}

/** 「ロゴ」の節。`brand` が無ければ出さない。 */
function brandSection(spec: DesignTokenSpec, ctx: GenerateContext, headings: PageHeading[]): Child {
  const brand = spec.brand;
  if (brand === null || brand.icon === null) return null;
  const path = brand.icon;
  const fact = brandIconFact(spec, ctx);
  const placeholder = brand.placeholder;
  return section('logo', DESIGN_WORDS.logo, headings, () => [
    el('p', null, fact === null ? logoUnembedded(path) : logoImage(fact)),
    el('p', null, DESIGN_WORDS.path, mono(path)),
    placeholder === null ? null : el('p', null, bold(DESIGN_WORDS.provisional), ' ', placeholder.reason),
  ]);
}

/** 小見出し(`h3`)。目次にも積む。 */
function subheading(id: string, title: string, headings: PageHeading[]): Html {
  headings.push({ level: 3, id, title: el('span', null, title) });
  return el('h3', { id }, title);
}

/** テーマのトークンの節(トークン一覧とコントラスト検査)。 */
function tokenSection(spec: DesignTokenSpec, headings: PageHeading[]): Html {
  return section('tokens', themeHeading(spec.theme).replace(/`/g, ''), headings, () => [
    subheading('token-list', TOKEN_LIST_HEADING, headings),
    table(
      TOKEN_HEADERS,
      tokenFacts(spec).map((token) => [
        el('span', { class: 'bf-nowrap' }, mono(`--${token.name}`)),
        token.group,
        token.group === 'color' ? join([el('span', { class: 'bf-swatch', 'data-token': token.name }), mono(token.value)]) : mono(token.value),
        token.ref === null ? dash() : mono(token.ref),
        token.note === '' ? dash() : token.note,
      ]),
    ),
    subheading('token-contrast', CONTRAST_HEADING, headings),
    table(
      CONTRAST_HEADERS,
      contrastFacts(spec).map((pair) => [mono(pair.fg), mono(pair.bg), `${pair.min}:1`, pair.actual === null ? dash() : pair.actual]),
    ),
  ]);
}

/** 見本 1 項目(見出し・本物の CSS で描いた舞台・部品名とトークン名)。 */
function demoItem(sample: PartsDemoFacts['samples'][number], roots: ProductRoots): Html {
  const stage = previewFragment(sample.stage) ?? previewRefused(sample.stage, `部品の見本 ${sample.title}`, roots);
  return el(
    'div',
    { class: 'bf-demo-item' },
    el('p', { class: 'bf-demo-title' }, sample.title),
    el('div', { class: 'parts-demo', inert: true }, stage),
    el(
      'p',
      { class: 'bf-demo-meta' },
      '部品: ',
      join(
        sample.names.map((name) => mono(name)),
        text(' '),
      ),
      sample.tokens.length === 0
        ? null
        : [
            ' / トークン: ',
            join(
              sample.tokens.map((token) => mono(token)),
              text(' '),
            ),
          ],
    ),
  );
}

/** パーツ見本の節の中身(前置き・見本・未掲載の部品クラス)。 */
function partsBody(facts: PartsDemoFacts, roots: ProductRoots): Child[] {
  return [
    el('p', null, inline(facts.lead)),
    facts.samples.map((sample) => demoItem(sample, roots)),
    facts.uncovered.length === 0
      ? null
      : el(
          'p',
          null,
          UNCOVERED_LEAD,
          ' ',
          join(
            facts.uncovered.map((name) => mono(`.${name}`)),
            text(' '),
          ),
        ),
  ];
}

/**
 * デザインの章の本文と目次。
 *
 * @param spec 読み込み済みのデザイントークン仕様
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function designChapter(model: SpecModel, ctx: GenerateContext, spec: DesignTokenSpec, countKey: string, file: string): ChapterBody {
  const headings: PageHeading[] = [];
  const icon = brandIconFact(spec, ctx);
  const parts = partsDemoFacts(model, ctx.book);
  const body = join([
    el('h1', null, icon === null ? null : [logoImage(icon), ' '], DESIGN_TITLE),
    countLine(model, ctx, countKey),
    el('p', null, inline(LEAD)),
    brandSection(spec, ctx, headings),
    tokenSection(spec, headings),
    section('parts', DESIGN_WORDS.parts, headings, () => (parts === null ? el('p', null, UNAVAILABLE) : partsBody(parts, ctx.roots))),
    signFold(spec.file, ctx, file),
  ]);
  return { body, headings };
}
