/**
 * 仕様の自由文の「例 …」を本文から分ける出し方(束 ブック ⑧-c2)のテスト。
 * 仕様の文は変えない: 例示は設定の章の `例` のラベル行に出し、本文は例示を除いた文になる。
 */

import { describe, expect, it } from 'vitest';
import { splitExamples } from '../../../../../lib/generate/render/book/prose-example.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage } from '../../../../helpers/book-html.js';
import { configModel, configVariable } from '../../../../helpers/config-builder.js';

describe('splitExamples', () => {
  it('括弧の中だけが例示のとき: 括弧ごと畳み、例示を取り出す', () => {
    expect(splitExamples('組織名そのもの(例 サンプル会)。コードに直書きしない')).toEqual({
      body: '組織名そのもの。コードに直書きしない',
      examples: ['サンプル会'],
    });
  });

  it('別の説明に続く例示(。例 …)は、括弧の閉じを残して畳む', () => {
    expect(splitExamples('URL の基点(オリジンまで。例 https://example.org)。OGP を作る')).toEqual({
      body: 'URL の基点(オリジンまで)。OGP を作る',
      examples: ['https://example.org'],
    });
    expect(splitExamples('基準タイムゾーン(IANA 名。例 Asia/Tokyo)').examples).toEqual(['Asia/Tokyo']);
  });

  it('全角の括弧と、文頭・読点の前の例示も分ける', () => {
    expect(splitExamples('値の説明(例 abc)')).toEqual({ body: '値の説明', examples: ['abc'] });
    expect(splitExamples('値の説明、例 abc。別の説明')).toEqual({ body: '値の説明。別の説明', examples: ['abc'] });
    expect(splitExamples('値の説明（例　全角）').examples).toEqual(['全角']);
  });

  it('例が無い文と、「例外」「例えば」の語は、そのまま返す', () => {
    for (const text of ['起動時に例外で落ちる', '例えば落ちる', '例外のとき落ちる', '']) {
      expect(splitExamples(text)).toEqual({ body: text, examples: [] });
    }
  });
});

describe('設定の章の出し方', () => {
  const ctx = {
    ...bookCtx(),
    config: configModel([configVariable('APP_NAME', { summary: '表示名(例 Foo座)。直書きしない', absence: '落ちる' })]),
  };
  const content = bookHtmlPage(bookModel(), ctx, 'config.html') ?? '';

  it('例示は `例` の行に出て、「決まること」の本文には残らない', () => {
    expect(content).toContain('<div class="bf-k">例</div><div class="bf-v">Foo座</div>');
    expect(content).toContain('<div class="bf-v">表示名。直書きしない</div>');
    expect(content).not.toContain('表示名(例 Foo座)');
  });

  it('例が無い設定には `例` の行を出さない', () => {
    const plain = bookHtmlPage(bookModel(), { ...ctx, config: configModel([configVariable('MODE')]) }, 'config.html') ?? '';

    expect(plain).not.toContain('<div class="bf-k">例</div>');
  });
});
