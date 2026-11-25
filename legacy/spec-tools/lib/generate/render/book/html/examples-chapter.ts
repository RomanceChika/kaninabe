/**
 * 「書き方の例」の章の HTML 版。
 *
 * 中身は `examples-page.ts` の事実と語で、並びは: 導入 → カテゴリごとの節(導入 → 実例ごとの小見出し → 抜粋の並び)。
 * 抜粋は実コード・実仕様から切り出したもので、`examples-page-render.ts` の `resolveExamples` の解決(未解決の印・40 行上限・未参照の印は生成エラー)を読む。
 * この章自身はファイルを読まず、throw もしない(読み取りと鮮度エラーは解決の側に閉じている)。
 *
 * コードと仕様の節の抜粋は `<pre><code>` で出す(言語は `data-lang`)。標識の抜粋は、HTML は Markdown として読まないので、
 * 標識の折りたたみ(`signFold`)と同じく原文の字を改行を保って出す(引用の中の太字などの記法は読まない)。導入の規約へのリンクは、規約のファイルへの同じ相対パス。
 * 節の見出しに目次用の `id` を持つ。
 */

import { CODE_EXAMPLES_HREF, EXAMPLES_LEAD, EXAMPLES_TITLE } from '../examples-page.js';
import type { ResolvedCategory, ResolvedExample, ResolvedExcerpt, ResolvedStep } from '../examples-page-render.js';
import { section, segments, type ChapterBody } from './chapter-parts.js';
import { bold, inline } from './face-parts.js';
import { el, join, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';

/** 章の題。 */
export { EXAMPLES_TITLE };

/** 抜粋 1 つ(コードと仕様の節は `<pre><code>`、標識は原文の引用)。 */
function excerptBlock(excerpt: ResolvedExcerpt): Html {
  if (excerpt.kind === 'quote') return el('blockquote', { class: 'bf-sign' }, el('p', { class: 'bf-sign-text' }, excerpt.body));
  return el('pre', { class: 'bf-code' }, el('code', { class: `language-${excerpt.lang}`, 'data-lang': excerpt.lang }, excerpt.body));
}

/** 段 1 つ(ラベル → 前振り → 抜粋 → 注)。 */
function stepBlock(step: ResolvedStep): Child[] {
  return [
    el('p', null, bold(inline(step.label))),
    step.bridge === undefined ? null : el('p', null, inline(step.bridge)),
    step.excerpt === undefined ? null : excerptBlock(step.excerpt),
    step.note === undefined ? null : el('p', null, el('em', null, inline(step.note))),
  ];
}

/** 実例 1 つ(小見出し → 導入 → 段の並び)。 */
function exampleBlock(example: ResolvedExample, id: string, headings: PageHeading[]): Child[] {
  headings.push({ level: 3, id, title: el('span', null, example.title) });
  return [el('h3', { id }, example.title), example.intro === '' ? null : el('p', null, inline(example.intro)), example.steps.map(stepBlock)];
}

/**
 * 書き方の例の章の本文と目次。
 *
 * @param categories 解決済みのカテゴリ(`resolvedExamples`)
 */
export function examplesChapter(categories: readonly ResolvedCategory[]): ChapterBody {
  const headings: PageHeading[] = [];
  const body = join([
    el('h1', null, EXAMPLES_TITLE),
    el(
      'p',
      null,
      segments(EXAMPLES_LEAD, () => CODE_EXAMPLES_HREF),
    ),
    categories.map((category, index) => {
      const id = `category-${index + 1}`;
      return section(id, category.title, headings, () => [
        category.intro === '' ? null : el('p', null, inline(category.intro)),
        category.examples.map((example, at) => exampleBlock(example, `${id}-example-${at + 1}`, headings)),
      ]);
    }),
  ]);
  return { body, headings };
}
