/**
 * 製品の宣言(`product.md`)の任意の欄 `summary`(製品が何かを 1 行で言う文)のテスト。
 *
 * 見たいのは 4 つ。
 *   ① 書いていなければ何も出ない(推測の文・既定の文を入れない)—— 題材(samples)の宣言でも同じ
 *   ② 空・改行・長すぎ・文字列でない・置けない文字は、名指しの error になり、値は採られない
 *   ③ 書いてあれば、ハンドブックの表紙に出る
 *   ④ 注入になりうる文字列(`{{` `<script>` …)は、HTML の出力の口(`html/markup.ts`)を経て字として逃がされる
 *
 * `TEST_ROOTS` は使わない —— 宣言そのものの読み方を試すので、自分でフィクスチャを組む。
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bookHtmlPage } from '../../helpers/book-html.js';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { MAX_SUMMARY_LENGTH, parseProductSummary } from '../../../lib/model/product/parse-summary.js';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { bookCtx, bookModel } from '../../helpers/book-fixture.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import type { ProductRoots } from '../../../lib/model/product/types.js';

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 必須の 4 根と採る種類(何も採らない)。 */
const BODY = ['roots:', '  specs: spec', '  book: read', '  generated: impl/src/generated', '  migrations: db/migrations', 'uses: []'];

/** 一言の行を差し込んだ宣言を 1 枚だけ持つ一時ツリーを作る(行を渡さなければ summary を書かない)。 */
function repoWith(summaryLines: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'product-summary-'));
  created.push(root);
  const lines = ['---', 'doc_type: product_roots', 'scope: common', 'id: product-roots', '', 'name: test-product', ...summaryLines, ...BODY, '---', ''];
  writeFileSync(path.join(root, PRODUCT_DECL_FILE), lines.join('\n'));
  return root;
}

/** 純粋関数を直接呼ぶ(YAML の読み込みより手前の防御も見たいので、値を直接渡す)。 */
function parse(value: unknown): { readonly value: string | undefined; readonly findings: readonly { readonly message: string; readonly pointer: string | undefined }[] } {
  const reporter = new SpecReporter(PRODUCT_DECL_FILE);
  const parsed = parseProductSummary({ summary: value }, reporter);
  return { value: parsed, findings: reporter.findings().map((finding) => ({ message: finding.message, pointer: finding.location.pointer })) };
}

describe('summary を読む', () => {
  it('書いた 1 行は、そのままの文字列として読める', () => {
    const result = loadProductRoots(repoWith(['summary: 利用者が記録を書き、仲間が読む製品です。']));

    expect(result.findings).toEqual([]);
    expect(result.model.roots?.summary).toBe('利用者が記録を書き、仲間が読む製品です。');
  });

  it('書かなければ summary のキー自体が無い(製品の名前などから文を作らない・既定の文を入れない)', () => {
    const roots = loadProductRoots(repoWith([])).model.roots;

    expect(roots).not.toBeNull();
    expect(roots).not.toHaveProperty('summary');
    expect(roots?.summary).toBeUndefined();
  });

  it('上限ちょうどの字数は通り、UTF-16 で 2 単位になる字も 1 字として数える', () => {
    expect(parse('あ'.repeat(MAX_SUMMARY_LENGTH)).value).toBe('あ'.repeat(MAX_SUMMARY_LENGTH));
    expect(parse('𠮷'.repeat(MAX_SUMMARY_LENGTH)).value).toBe('𠮷'.repeat(MAX_SUMMARY_LENGTH));
    expect(parse('𠮷'.repeat(MAX_SUMMARY_LENGTH + 1)).value).toBeUndefined();
  });

  it('宣言の中の欄としては、知らないキーではない(typo は引き続き落ちる)', () => {
    const typo = loadProductRoots(repoWith(['summry: 利用者が記録を書く製品です。']));

    expect(typo.findings.map((finding) => [finding.verifier, finding.location.pointer])).toEqual([['P0', 'summry']]);
  });

  it('書いたのに受け付けない値は、P0 が名指しで error にし、値は採られない(黙って落とさない)', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['空', 'summary: ""'],
      ['空白だけ', 'summary: "   "'],
      ['改行(YAML の \\n)', 'summary: "一行目\\n二行目"'],
      ['長すぎ', `summary: ${'あ'.repeat(MAX_SUMMARY_LENGTH + 1)}`],
      ['文字列でない(数)', 'summary: 123'],
      ['文字列でない(リスト)', 'summary: [a, b]'],
    ];
    for (const [label, line] of cases) {
      const result = loadProductRoots(repoWith([line]));

      expect(result.findings.length, label).toBeGreaterThan(0);
      expect(result.findings.every((finding) => finding.verifier === 'P0' && finding.severity === 'error'), label).toBe(true);
      expect(result.model.roots?.summary, label).toBeUndefined();
    }
  });
});

describe('summary の値域(純粋関数)', () => {
  it.each([
    ['空', '', 'summary が空です'],
    ['空白だけ', '  ', 'summary が空です'],
    ['LF', '一行目\n二行目', '改行'],
    ['CR', '一行目\r二行目', '改行'],
    ['行の区切り U+2028', '一行目\u2028二行目', '改行'],
    ['長すぎ', 'あ'.repeat(MAX_SUMMARY_LENGTH + 1), '長すぎ'],
    ['文字列でない(数)', 123, '文字列で書きます'],
    ['文字列でない(真偽)', true, '文字列で書きます'],
    ['文字列でない(リスト)', ['a'], '文字列で書きます'],
    ['制御文字(タブ)', '一\t二', 'U+0009'],
    ['制御文字(NUL)', '一\u0000二', 'U+0000'],
    ['零幅の空白', '一\u200B二', 'U+200B'],
    ['向きを変える文字', '一\u202E二', 'U+202E'],
    ['前後の空白', ' 利用者が記録を書く製品です。', '前後に空白'],
  ])('%sは名指しの error で、値は採られない', (_label, value, fragment) => {
    const { value: parsed, findings } = parse(value);

    expect(parsed).toBeUndefined();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.pointer).toBe('summary');
    expect(findings[0]?.message).toContain(fragment);
  });

  it('書いていなければ(キーなし・null)何も言わず、値も無い', () => {
    const reporter = new SpecReporter(PRODUCT_DECL_FILE);

    expect(parseProductSummary({}, reporter)).toBeUndefined();
    expect(parseProductSummary({ summary: null }, reporter)).toBeUndefined();
    expect(reporter.findings()).toEqual([]);
  });
});

describe('題材(samples)の宣言は summary を書かない', () => {
  const samplesDir = path.join(import.meta.dirname, '../../fixtures/samples');
  const samples = readdirSync(samplesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  it('題材が 1 つ以上ある(空振りで緑にならない)', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it.each(samples.map((entry) => [entry.name]))('%s: 宣言は読めて summary は無く、表紙に一言の行は出ない', (name) => {
    const roots = loadProductRoots(path.join(samplesDir, name)).model.roots;

    expect(roots).not.toBeNull();
    expect(roots).not.toHaveProperty('summary');

    const ctx = { ...bookCtx(), roots: roots ?? TEST_ROOTS };
    const page = bookHtmlPage(bookModel(), ctx, 'index.html') ?? '';

    expect(page).toContain('<h1>');
    expect(page).not.toContain('class="bf-summary"');
  });
});

/** summary のキーを持たない根(書いていない製品)。 */
function omitSummary(roots: ProductRoots): ProductRoots {
  return Object.fromEntries(Object.entries(roots).filter(([key]) => key !== 'summary')) as unknown as ProductRoots;
}

describe('ハンドブックの表紙(HTML)', () => {
  /** 表紙のページ(HTML の文書)。 */
  function cover(summary: string | undefined): string {
    // このリポジトリの宣言は一言を持つので、「書いていない」製品は summary のキーを外して作る。
    const roots: ProductRoots = summary === undefined ? omitSummary(TEST_ROOTS) : { ...TEST_ROOTS, summary };
    return bookHtmlPage(bookModel(), { ...bookCtx(), roots }, 'index.html') ?? '';
  }

  /** 題字の直後の一言の行(`<p class="bf-summary">…</p>`)。 */
  const summaryLine = (page: string): string | undefined => /<h1>[^<]*<\/h1>(<p class="bf-summary">.*?<\/p>)/s.exec(page)?.[1];

  it('書いてあれば、題字の直後に 1 行を出す', () => {
    expect(summaryLine(cover('利用者が記録を書き、仲間が読む製品です。'))).toBe('<p class="bf-summary"><strong>利用者が記録を書き、仲間が読む製品です。</strong></p>');
  });

  it('書いていなければ、表紙は書いたときから一言の行だけ違う(何も足さない)', () => {
    const without = cover(undefined);
    const withOne = cover('利用者が記録を書き、仲間が読む製品です。');

    expect(without).not.toContain('利用者が記録を書き');
    expect(summaryLine(without)).toBeUndefined();
    expect(withOne.replace('<p class="bf-summary"><strong>利用者が記録を書き、仲間が読む製品です。</strong></p>', '')).toBe(without);
  });

  it('TEST_ROOTS(このリポジトリの宣言)は、一言を持つ製品の宣言として表紙に出せる', () => {
    expect(TEST_ROOTS.summary).toBeDefined();
    expect(summaryLine(cover(TEST_ROOTS.summary))).toContain(`<strong>${TEST_ROOTS.summary ?? ''}</strong>`);
  });

  it.each([
    ['Vue の式', '{{ constructor.constructor("x")() }}'],
    ['script タグ', '<script>alert(1)</script>'],
    ['属性の記法', '{.x #app}'],
    ['文字参照の波括弧', '&#123;&#123;x&#125;&#125;'],
    ['イベント属性つきのタグ', '<img src=x onerror=alert(1)>'],
    ['行頭の見出し', '# 見出し'],
    ['リンク', '[x](javascript:alert(1))'],
    ['容器の記法', '::: v-pre'],
    ['強調を閉じて抜ける試み', '** <div> **'],
  ])('注入になりうる文字列(%s)は字として逃がされて出る', (_label, hostile) => {
    const page = cover(hostile);
    const line = summaryLine(page) ?? '';

    expect(line.startsWith('<p class="bf-summary"><strong>')).toBe(true);
    expect(line.endsWith('</strong></p>')).toBe(true);
    // 一言の行の中に、生のタグ・属性が残らない(`<` `>` `&` `"` `'` は実体参照になる)。
    const inner = line.slice('<p class="bf-summary"><strong>'.length, -'</strong></p>'.length);
    expect(inner).not.toMatch(/[<>"']/);
    // 表紙のどこにも、注入した生のタグが現れない。
    expect(page).not.toMatch(/<script>alert/i);
    expect(page).not.toMatch(/<img\s+src=x/i);
    expect(page).not.toMatch(/<div> \*\*/);
  });
});
