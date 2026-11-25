/**
 * **語の寄せ集めの無作為な文書**を、Vue の構文木とコンパイルで判定する(種を固定)。
 *
 * `book-oracle.test.ts` は構造の行 × 敵対的な行、`book-oracle-mixed.test.ts` は登録した断片との混在を見る。ここは、許可表のタグの開き・閉じ・部品・スロット・
 * Markdown の記号・属性の記法 `{…}`・改行と空行を **1 語ずつ無作為に並べた**文書を見る(文法に沿わない並びが、処理系の解釈の食い違いを掘り当てる)。
 * 判定は注入(式・`on*`・危険な URL・予約された `id`)と、Vue のコンパイルの誤り(閉じていないタグ・余分な閉じ・置き場の違うスロット・重複した属性)。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { resetTrusted } from '../../../lib/kernel/trusted-html.js';
import { COUNTEREXAMPLE_SEEDS, FUZZ_SEED, seededRandom, SOUP_TOKENS, variableSeed } from '../../helpers/book-fuzz.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

const available = existsSync(VITEPRESS_ENTRY);

/** 件数。 */
const SOUP_CASES = 40_000;

describe.skipIf(!available)('語の寄せ集めの無作為な文書(種を固定)', () => {
  let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });

  beforeAll(async () => {
    audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
    resetTrusted();
  });

  /** 種と件数を決めて文書を作り、判定が赤になったものを集める。 */
  const run = (seed: number, cases: number): string[] => {
    const random = seededRandom(seed);
    const failures: string[] = [];
    for (let index = 0; index < cases; index += 1) {
      const count = 3 + Math.floor(random() * 28);
      let source = 'head\n';
      for (let word = 0; word < count; word += 1) source += SOUP_TOKENS[Math.floor(random() * SOUP_TOKENS.length)] ?? '';
      const { issues } = audit(source);
      if (issues.length > 0) failures.push(`種 ${seed}: ${JSON.stringify(source)} → ${issues[0]}`);
      if (failures.length >= 10) break;
    }
    return failures;
  };

  it(`種 ${FUZZ_SEED} で ${SOUP_CASES} 件。注入が無く、Vue のコンパイルが通る`, () => {
    expect(run(FUZZ_SEED, SOUP_CASES)).toEqual([]);
  }, 600_000);

  it('第 2 の種で 10000 件(別の種は環境変数 FUZZ_SEED で手で試す)', () => {
    expect(run(variableSeed(), 10_000)).toEqual([]);
  }, 600_000);

  it('反例集に点検 13 回目の種がある', () => {
    expect(COUNTEREXAMPLE_SEEDS).toContain(517_594_764);
  });

  it.each(COUNTEREXAMPLE_SEEDS)('反例の種 %i で 10000 件', (seed) => {
    expect(run(seed, 10_000)).toEqual([]);
  }, 600_000);

  it('種 517594764 の文書そのもの: URL に飲まれるタグの対を通さない', () => {
    const source = 'head\n<div class="c">http://x.y/z{<summary>~~~<section>```x"y{#app}<dt><dd>```x"y </section>\n\n';
    expect(audit(source).issues).toEqual([]);
  });

  it('無害化しないと判定が赤になる(判定者が何も見ていないまま緑にならない)', () => {
    expect(audit('head\nx { #app}', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('head\n<div>x', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('head\n<template #a>x</template>', { sanitize: false }).issues.length).toBeGreaterThan(0);
  });
});
