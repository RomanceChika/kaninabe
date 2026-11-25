/**
 * レビューの手引き(HTML の本。render/book/html/review-guide-chapter.ts)のテスト。
 *
 * wholeFile 出力・章ごとの索引行(標識の本数と判断ポイントの内訳)・ブロックごとの表・
 * 判断が 0 の章への「流し読みで良い」の定型判定を検める。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';

function html(): string {
  const page = bookHtmlPage(bookModel(), bookCtx(), 'review-guide.html');
  if (page === undefined) throw new Error('ページが生成されませんでした');
  return page;
}

describe('レビューの手引き(HTML): 出力先と骨格', () => {
  it('docs/book/review-guide.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file === 'docs/book/review-guide.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('保証マップ(数え方の正)への docs/ 内リンクを持つ', () => {
    expect(pageText(html())).toContain('system-spec-route.md の保証マップ');
    expect(html()).toContain('href="../rules/process/common/specification/playbooks/system-spec-route.md"');
  });
});

describe('レビューの手引き(HTML): 章ごとの判定', () => {
  it('判断が乗る章は精読の行(ラベル合算の内訳と標識の本数)になる', () => {
    const text = pageText(html());

    expect(text).toMatch(/集約 workshop — 精読: 標識 2 本・判断ポイント \d+ 件\([^\n]*遷移 2[^\n]*\)/);
  });

  it('ブロックごとの表が、章の行と同じ集計から出る(節・仕様ファイル・標識・判断ポイント)', () => {
    const text = pageText(html());

    expect(text).toContain('ブロックごとの数');
    // 標識 1 本・判断ポイント 0 のブロック(action_spec)と、標識 1 本・判断ポイントを持つブロック(access_spec)。
    expect(text).toMatch(/操作 — 誰が、いつ、何をできるか \| backend\/actions\/workshop\/publish\.md \| 1 \| 0 \| —/);
    expect(text).toMatch(/誰に見えるか \| domain\/workshop\/access\.md \| 1 \| 3 \| reads 2・うち scope:all 1・writes 1/);
    // 標識も判断ポイントも無い章(member)は表を持たない。
    expect(text.split('ブロックごとの数')[1] ?? '').not.toMatch(/^集約 member$/m);
  });

  it('精読不要を宣言した章だけが「流し読みで良い」になる(理由も出る)', () => {
    const text = pageText(html());

    expect(text).toContain('一通り試すとは何か(L2 網羅台帳) — 流し読みで良い: この章に対応する仕様ファイルが無い');
  });

  it('宣言が無いまま 0 件の章は「未分類(要確認)」になる(数えていないのかもしれない)', () => {
    const text = pageText(html());

    expect(text).toContain('集約 member — 未分類(要確認)');
    expect(text).toContain('精読不要の宣言が無い');
    // 「流し読みで良い」と書かせない —— ここが 外部レビュー の外部レビュー④の指摘そのものである。
    expect(text).not.toContain('集約 member — 流し読みで良い');
  });
});

describe('レビューの手引き(HTML): 人が書く文の未記入', () => {
  it('章ごとに 章頭・節の要約・段の場面の未記入と、記入済み / 場所を数える(書いた分は減る)', () => {
    const text = pageText(html());
    const rows = text
      .split('\n')
      .filter((line) => line.startsWith('集約 '))
      .filter((line) => /^集約 [^|]+ \| \d+ \| \d+ \| \d+ \| \d+ \| \d+ \/ \d+$/.test(line));

    expect(text).toContain('人が書く文の未記入');
    expect(rows.length).toBeGreaterThan(0);
    // 書く場所の総数 = 未記入 + 記入済み(どの章でも)。
    for (const row of rows) {
      const cells = row.split('|').map((cell) => cell.trim());
      const gaps = cells.slice(1, 4).reduce((sum, cell) => sum + Number(cell), 0);
      const [written, places] = (cells[5] ?? '').split('/').map((part) => Number(part.trim()));
      expect(Number(cells[4])).toBe(gaps);
      expect((written ?? 0) + gaps).toBe(places);
    }
    expect(text).toMatch(/いまの未記入は全章で \d+ 件\(書く場所は \d+ か所\)/);
  });
});
