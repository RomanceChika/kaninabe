/**
 * ハンドブックの表紙(HTML の本。render/book/html/index-chapter.ts)のテスト。
 *
 * wholeFile 出力・規模の数え上げ・集約関係図とロール表の同梱・章への導線を検める
 * (文章の中身ではなく骨格と写像の正しさを見る。HTML の字と要素で見る)。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { ledger, term } from '../../../../helpers/terms-builder.js';
import { specModel } from '../../../../helpers/model-builder.js';

/** 表紙のページ(HTML の文書)。 */
function html(ctx = bookCtx(), model = bookModel()): string {
  const page = bookHtmlPage(model, ctx, 'index.html');
  if (page === undefined) throw new Error('ページが生成されませんでした');
  return page;
}

/** 表紙の字。 */
const content = (ctx = bookCtx(), model = bookModel()): string => pageText(html(ctx, model));

describe('表紙(HTML): 出力先と骨格', () => {
  it('docs/book/index.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file === 'docs/book/index.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('「全体が生成物」のヘッダを含む', () => {
    expect(html()).toContain('<!-- このファイルは全体が生成物である');
  });

  it('語彙集(この本に出てくる言葉)を規模より前に置く', () => {
    const text = content();

    expect(text).toContain('この本に出てくる言葉');
    expect(text).toContain('集約 | 守られるルールの境界を 1 単位にしたもの');
    expect(text.indexOf('この本に出てくる言葉')).toBeLessThan(text.indexOf('\n規模\n'));
  });

  it('語彙集の行は台帳の face: book の行で、宣言順に並ぶ(framework の行は出さない)', () => {
    const text = content();

    expect(text).toContain('言葉 | 意味');
    expect(text).toContain('集約 | 守られるルールの境界を 1 単位にしたもの');
    expect(text.indexOf('集約 | 守られる')).toBeLessThan(text.indexOf('状態機械 | その集約'));
    expect(text.indexOf('状態機械 | その集約')).toBeLessThan(text.indexOf('ロール | 誰が'));
    expect(text).not.toContain('注釈 |');
  });

  it('{例} は仕様の宣言から採った例に差し替わる(状態機械の例・文脈依存ロールの例)', () => {
    const text = content();

    expect(text).toContain('状態機械 | その集約のライフサイクル(例: 下書き → 受付中)。矢印に無い移動はできない');
    expect(text).toContain('ロール | 誰が。文脈依存ロール(例: そのorganizer)がある');
    expect(text).not.toContain('{例}');
  });

  it('宣言が無ければ {例} は空になる(語を捏造しない)', () => {
    const terms = {
      available: true,
      ledger: ledger([term('状態機械', { id: 'state_machine', face: 'book', gloss: 'ライフサイクル{例}です' })]),
    };

    expect(content({ ...bookCtx(), terms }, specModel([]))).toContain('状態機械 | ライフサイクルです');
  });

  it('台帳が無い環境では表を作らず、その旨を 1 行で言う(空の表を出さない)', () => {
    const none = content({ ...bookCtx(), terms: { available: false, ledger: null } });
    const { terms: _dropped, ...withoutTerms } = bookCtx();
    const absent = content(withoutTerms);

    for (const text of [none, absent]) {
      expect(text).toContain('この本に出てくる言葉');
      expect(text).toContain('face: book の語がまだ無い');
      expect(text).not.toContain('言葉 | 意味');
      expect(text).toContain('実装の側の 3 語');
    }
  });

  it('brand が無ければ題字にロゴを出さない', () => {
    const page = html();

    expect(page).toContain('<h1>システムハンドブック</h1>');
    expect(page).not.toContain('<img');
  });
});

describe('表紙(HTML): 規模と図', () => {
  it('規模の表は仕様からの数え上げ(集約・イベント・query・画面・トークン)', () => {
    const text = content();

    expect(text).toContain('集約 | 2(うち状態機械を持つもの: workshop)');
    expect(text).toContain('状態遷移(イベント) | 2');
    expect(text).toContain('読み取り経路(query) | 2');
    expect(text).toContain('画面 | 2(共有クローム 1)');
    expect(text).toContain('デザイントークン | 2(テーマ: test_theme)');
  });

  it('query / screen / design が無い環境では、その行を出さない(数字を捏造しない)', () => {
    const text = content(GEN_CTX);

    // 語彙集(テンプレート)にも同じ言葉が出るため、規模表の行の形で見る
    expect(text).not.toContain('読み取り経路(query) |');
    expect(text).not.toMatch(/^画面 \|/m);
    expect(text).not.toContain('デザイントークン |');
  });

  it('集約関係図とロール一覧を同じページに含む', () => {
    const page = html();
    const text = pageText(page);

    expect(page).toContain('aria-label="集約はどう結びついているか"');
    expect(page).toContain('href="./spec/workshop.html"');
    expect(text).toContain('organizer | — | 文脈依存 | workshop.organizer_id == actor.id | member');
  });
});

describe('表紙(HTML): 導線', () => {
  it('全章とレビューの手引きへのリンクを持つ', () => {
    const page = html();

    expect(page).toContain('<li><a href="./spec/workshop.html">集約 workshop</a>');
    expect(page).toContain('<li><a href="./screens.html">画面</a></li>');
    expect(page).toContain('<li><a href="./visibility.html">誰に何が見えるか</a></li>');
    expect(page).toContain('<li><a href="./design.html">デザイン</a></li>');
    expect(page).toContain('href="./review-guide.html"');
  });
});
