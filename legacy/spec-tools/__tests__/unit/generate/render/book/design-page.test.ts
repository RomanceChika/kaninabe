/**
 * デザインの章(HTML の本。render/book/html/design-chapter.ts)のテスト。
 *
 * wholeFile 出力・トークン表の流用(token-tables と同じ表 + 色スウォッチ)・
 * パーツ見本の同梱・トークン仕様が無い環境の扱いを検める。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlFiles, bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { brand, colorToken, group, tokenSpec } from '../../../../helpers/design-builder.js';

describe('デザインの章(HTML)', () => {
  it('docs/book/design.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file === 'docs/book/design.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('トークン一覧(色スウォッチつき)とコントラスト検査(実比の計算込み)を含む', () => {
    const page = bookHtmlPage(bookModel(), bookCtx(), 'design.html') ?? '';
    const text = pageText(page);

    expect(text).toContain('テーマ test_theme のトークン');
    expect(text).toContain('--color-ink | color | #111111 |');
    expect(page).toContain('<span class="bf-swatch" data-token="color-ink"></span>');
    expect(text).toContain('コントラスト検査（contrast）');
    expect(text).toMatch(/color-ink \| color-canvas \| 4\.5:1 \| \d+\.\d{2}:1/);
  });

  it('パーツ見本の章を持つ(実装 CSS が無い環境ではプレースホルダ)', () => {
    const text = pageText(bookHtmlPage(bookModel(), bookCtx(), 'design.html') ?? '');

    expect(text).toContain('デザインパーツ見本(実 CSS の写し)');
    // bookCtx は実装 CSS(book.uiCss)を持たないので、見本ではなくプレースホルダが出る。
    expect(text).toContain('ui.module.css)を読めなかった');
  });

  it('トークン仕様が無い環境では何も生成しない', () => {
    expect(bookHtmlFiles(bookModel(), GEN_CTX).has('docs/book/design.html')).toBe(false);
  });

  it('brand が無ければロゴを見出しにも節にも出さない', () => {
    const page = bookHtmlPage(bookModel(), bookCtx(), 'design.html') ?? '';

    expect(pageText(page)).toContain('デザイン');
    expect(page).not.toContain('<img');
    expect(pageText(page)).not.toContain('ロゴ');
  });

  it('brand(placeholder あり)+ 実装 SVG があれば、見出しに (仮) 付きの <img> と「ロゴ」節を出す', () => {
    const ctx = {
      ...bookCtx(),
      design: {
        available: true,
        spec: tokenSpec({
          groups: [group('color', [colorToken('color-ink', '#111111'), colorToken('color-canvas', '#ffffff')])],
          contrast: [{ fg: 'color-ink', bg: 'color-canvas', min: 4.5 }],
          brand: brand({ placeholderReason: '実物のロゴ待ち' }),
        }),
      },
      book: { brandIconSvg: '<svg></svg>' },
    };

    const page = bookHtmlPage(bookModel(), ctx, 'design.html') ?? '';
    const text = pageText(page);

    expect(page).toContain('<img src="./assets/brand-icon.svg"');
    expect(text).toContain('(仮)');
    expect(text).toContain('ロゴ');
    expect(text).toContain('app/src/app/icon.svg');
    expect(text).toContain('仮のアイコン。 実物のロゴ待ち');
  });
});
