/**
 * 本(HTML)の生成器の出力を、テストが「章の事実」を見るための道具。
 *
 * `bookHtmlPage` は本の生成器(`book-html` / `book-html-examples`)を回して、ある章のページ(HTML の文書)を返す。
 * `pageText` はその本文を読む字にする: 表のセルは ` | `、行・段落・見出し・項目は改行で区切り、タグを除き、実体参照を戻す。
 * 章の中の事実(行・件数・語・どの項目が出るか)の検査は、この字に対して書く(Markdown の本が無くなったので、表の記法ではなく字で見る)。
 */

import type { GeneratedSection, GenerateContext } from '../../lib/gen-kit/generator.js';
import type { SpecModel } from '../../lib/model/types.js';
import { bookHtmlGenerator } from '../../lib/generate/render/book/html/generator.js';
import { bookHtmlExamplesGenerator } from '../../lib/generate/render/book/html/examples-generator.js';
import { bookFile } from '../../lib/generate/render/book/chapters.js';
import { pageBody } from './book-notice-probe.js';

/** 本の全ページ(ファイル → 中身)。同じファイルへ複数のセクションがあれば連ねる。 */
export function bookHtmlFiles(model: SpecModel, ctx: GenerateContext): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const generator of [bookHtmlGenerator, bookHtmlExamplesGenerator]) {
    for (const section of generator.generate(model, ctx)) files.set(section.file, `${files.get(section.file) ?? ''}${section.content}`);
  }
  return files;
}

/**
 * 本のページ 1 枚(HTML の文書)。
 *
 * @param name 本の根の中のファイル名(例: `data.html`・`domain/item.html`)
 * @returns ページ。生成器が出さない章(材料が無い)なら undefined
 */
export function bookHtmlPage(model: SpecModel, ctx: GenerateContext, name: string): string | undefined {
  return bookHtmlFiles(model, ctx).get(bookFile(ctx.roots, name));
}

/** 名前つきの実体参照(出力の口が作るもの)。 */
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * HTML の断片(またはページ)を読む字にする。ページを渡すと本文(`.vp-doc` の中)だけを読む。
 *
 * @param html ページか断片
 */
export function pageText(html: string): string {
  const source = html.startsWith('<!doctype html>') ? pageBody(html) : html;
  return source
    .replace(/<svg\b[\s\S]*?<\/svg>/g, '')
    .replace(/<\/t[dh]>/g, ' | ')
    .replace(/<\/?(?:tr|p|li|ul|ol|table|thead|tbody|h[1-6]|div|section|details|summary|blockquote|br|dl|dt|dd)\b[^>]*>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|([a-z]+));/g, (whole, code: string | undefined, name: string | undefined) =>
      code !== undefined ? String.fromCodePoint(Number.parseInt(code, 10)) : (NAMED[name ?? ''] ?? whole),
    )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/(?: \|)+ ?$/, '').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * 本の生成器が出した、ある章のセクション(その章を出さない環境では空)。旧い「章ごとの生成器」の出力の形(`[{ file, content, wholeFile }]`)で返す。
 * `content` は HTML の文書なので、字の検査は `pageText` を通す。
 *
 * @param name 本の根の中のファイル名(例: `auth.html`)
 */
export function bookChapterSections(model: SpecModel, ctx: GenerateContext, name: string): GeneratedSection[] {
  const file = bookFile(ctx.roots, name);
  return [bookHtmlGenerator, bookHtmlExamplesGenerator].flatMap((generator) => generator.generate(model, ctx).filter((section) => section.file === file));
}
