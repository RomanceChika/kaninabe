/**
 * **本物の VitePress の Markdown 描画器**に、敵対的な文章を無害化してから通し、出てきた HTML に注入が無いことを見る
 * (字面の検索ではなく、描画の結果で見る。独立レビューが実測した迂回の再現を含む)。
 *
 * 見るのは、コードの外に ①Vue の式 `{{ }}` が残らない ②`v-*` / `:x` / `@x` / `on*` / `style` の属性が付かない ③`href` / `src` が危険なスキームにならない
 * こと。設定は docs の `markdown-options.ts`(markdown-it-attrs の許可属性を `id` だけにする)を本物の設定から読む。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { resetTrusted, trustSnippet } from '../../../lib/kernel/trusted-html.js';
import { createBookRenderer, hasForbiddenAttribute, outsideCode, VITEPRESS_ENTRY, type MarkdownRender } from '../../helpers/vitepress-render.js';

let render: MarkdownRender = () => '';

beforeAll(async () => {
  render = (await createBookRenderer()) ?? render;
});

/** 無害化してから描く。 */
const rendered = (source: string): string => render(sanitizeBookMarkdown(source));

/** 文字参照を戻す(href の判定用)。 */
function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:Tab|NewLine);/gi, '');
}


describe.skipIf(!existsSync(VITEPRESS_ENTRY))('VitePress の描画結果', () => {
  describe('markdown-it-attrs の {…} から属性を付けられない', () => {
    it.each([
      ['段落', 'text {v-html="1"}'],
      ['段落(onclick)', 'text {onclick=alert(1)}'],
      ['段落(:title)', 'text {:title="alert(1)"}'],
      ['段落(@click)', 'text {@click="alert(1)"}'],
      ['段落(v-if)', 'text {v-if="false"}'],
      ['段落(空白つき)', 'text { v-html="1" }'],
      ['段落(style)', 'text {style="position:fixed"}'],
      ['見出し', '## 見出し {v-html="1"}'],
      ['表のセル', '| a |\n|--|\n| x {:title="alert(1)"} |'],
      ['強調', '**太字**{onmouseover=alert(1)}'],
      ['箇条書き', '- item {onclick=alert(1)}'],
    ])('%s', (_name, source) => {
      expect(hasForbiddenAttribute(outsideCode(rendered(source)))).toBe(false);
    });

    it('見出しのアンカー {#id} は、生成器が登録した行だけ使える(登録の無い {#id} は id を付けない)', () => {
      const registry = resetTrusted();
      expect(render(sanitizeBookMarkdown('### jobs {#custom}'))).not.toContain('id="custom"');

      trustSnippet('### jobs {#custom}');

      expect(rendered('### jobs {#custom}')).toContain('id="custom"');
      expect(registry.snippets.size).toBe(1);
      resetTrusted();
    });

    it.each([
      ['{ #app}', 'x { #app}'],
      ['{#app}', 'x {#app}'],
      ['{.a #app}', 'x {.a #app}'],
      ['表のセルの中', '| a |\n|--|\n| x { #app} |'],
      ['リストの項目', '- a { #app}'],
      ['強調の直後', '*a*{ #app}'],
      ['{…} だけの段落', 'head\n\n{ #app}\n\nx'],
      ['見出し', '## T { #app}'],
    ])('零幅の文字を挟んだ {…} でも id を付けられない(DOM の名前の上書き): %s', (_name, source) => {
      resetTrusted();

      // DOM の名前の上書きに使われる予約された名前(VitePress の取り付け先)
      const mountPoint = ['a', 'pp'].join('');

      expect(rendered(`head\n${source}`)).not.toMatch(new RegExp(`\\sid="${mountPoint}`));
    });
  });

  describe('インラインコードの判定が CommonMark と同じ(コードの外の {{ }} が残らない)', () => {
    it.each([
      ['エスケープしたバッククォート', '\\`{{ 1+1 }}\\`'],
      ['長さの違う連なり', '``{{ 1+1 }}`'],
      ['長さの違う連なり(逆)', '`{{ 1+1 }}``'],
      ['フェンスに見える行(情報文字列にバッククォート)', '```a` {{ 1+1 }}'],
      ['閉じないバッククォート', '`{{ 1+1 }}'],
      ['バックスラッシュの二重の後ろ', '\\\\`{{ 1+1 }}`'],
      ['普通の本文', 'text {{ 1+1 }} text'],
      ['表', '| a |\n|--|\n| {{ 1+1 }} |'],
      ['見出し', '# {{ [].constructor.constructor("alert(1)")() }}'],
    ])('%s', (_name, source) => {
      expect(outsideCode(rendered(source))).not.toContain('{{');
    });

    it('フェンスの中の {{ も割る(コードの中でも式にならない)', () => {
      expect(rendered('```\n{{ z }}\n```\n')).not.toContain('{{');
    });
  });

  describe('URL の文字参照で危険なスキームを通さない', () => {
    it.each([
      ['jav&#x61;script:alert(1)'],
      ['jav&#97;script:alert(1)'],
      ['java&#9;script:alert(1)'],
      ['java&Tab;script:alert(1)'],
      ['javascript&colon;alert(1)'],
      ['java&NewLine;script:alert(1)'],
      ['&#100;ata:text/html,<script>alert(1)</script>'],
      ['  javascript:alert(1)'],
      ['vbscript:x'],
      ['//evil.example/x'],
      ['\\\\evil.example/x'],
      ['/\\evil.example/x'],
    ])('href=%j', (href) => {
      const html = rendered(`<a href="${href}">x</a>`);
      // 見るのは書かれたタグから出た href。文章として残った URL を描画器の自動リンクが拾ったもの(リンクの文字が href と同じ)は注入ではない
      const hrefs = [...html.matchAll(/<a\shref="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
        .filter((match) => match[1] !== match[2])
        .map((match) => decode(match[1] ?? '').replace(/[\s\u0000-\u001F]/g, '').toLowerCase());

      expect(hrefs.filter((value) => /^(javascript|data|vbscript):|^[\\\\/]{2}|\\\\/.test(value))).toEqual([]);
    });

    it('img の src も同じ', () => {
      const html = rendered('<img src="jav&#x61;script:alert(1)" alt="x">');

      expect(decode(html)).not.toMatch(/src="\s*javascript:/i);
    });

    it('通常の URL は残る', () => {
      expect(rendered('<a href="/items/1" class="x">リンク</a> <a href="https://example.com/">外</a>')).toContain('href="/items/1"');
    });
  });

  it('生の script・onerror・iframe は文字になり、タグとして残らない', () => {
    const html = rendered('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="//evil"></iframe>');

    expect(outsideCode(html)).not.toMatch(/<(script|iframe)\b/i);
    expect(outsideCode(html)).not.toMatch(/<img\b/i);
  });

  it('style は CSS のカスタムプロパティの宣言だけが残り、url() などは文字になる', () => {
    expect(rendered('<span style="--swatch: var(--color-text);">x</span>')).toContain('style="--swatch: var(--color-text);"');
    expect(outsideCode(rendered('<span style="background:url(//evil/?)">x</span>'))).not.toMatch(/<span style=/);
    expect(outsideCode(rendered('<span style="--a: url(//evil/?)">x</span>'))).not.toMatch(/<span style=/);
  });

  it('許可した部品・スロット・式の属性は残る(生成物の正常な HTML)', () => {
    const html = rendered("<Steps :items='[{\"title\":\"a\"}]'>\n\n<template #x>\n\n中身\n\n</template>\n\n</Steps>\n");

    expect(html).toContain(':items');
  });
});
