/**
 * 集約の章(HTML の本。render/book/html/aggregate-chapter.ts)の、仕様の写像としての中身のテスト。
 *
 * 集約ごとの wholeFile 出力と、章の中身が仕様の写像であること — フィールド表・
 * 遷移表とマトリクス・操作表(ガードの日本語つき)・⚠(scope: all)・DSL 外の目印・
 * 標識のインライン引用 — を検める(HTML の字で見る)。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';

function chapter(name: string): string {
  const page = bookHtmlPage(bookModel(), bookCtx(), `domain/${name}.html`);
  if (page === undefined) throw new Error(`${name} の章が生成されませんでした`);
  return pageText(page);
}

describe('集約の章(HTML): 出力先', () => {
  it('集約ごとに docs/book/domain/{name}.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file.startsWith('docs/book/domain/'));

    expect(sections.map((section) => section.file)).toEqual(['docs/book/domain/workshop.html', 'docs/book/domain/member.html']);
    expect(sections.every((section) => section.wholeFile === true)).toBe(true);
  });
});

describe('集約の章(HTML): 章の中身(workshop)', () => {
  it('フィールド表・遷移表・マトリクスを含む', () => {
    const text = chapter('workshop');

    expect(text).toContain('organizer_id | ref(member) | ✓ | — | 世話役');
    expect(text).toContain('workshop.publish(公開する) | draft(下書き) | accepting(受付中) | organizer');
    expect(text).toContain('状態＼イベント | publish(公開する) | close(締める)');
  });

  it('操作表は作成/遷移/編集を束ね、ガード・when を日本語の意味つきで出す', () => {
    const text = chapter('workshop');

    // 遷移(guard)は entity_spec の description と label に写る
    expect(text).toContain('now >= workshop.starts_at');
    expect(text).toContain('現在時刻 ≥ 開演日時');
    // writes は {entity}.update として同じ表に載る
    expect(text).toContain('workshop.update | 編集: title | organizer | state == draft | 催しの状態 = 下書き');
  });

  it('scope: all の行に ⚠ が付き、system は一覧に出ない', () => {
    const text = chapter('workshop');

    expect(text).toContain('member | 全件(all) ⚠ |');
    expect(text).not.toMatch(/^system \| 全件/m);
  });

  it('DSL 外の不変条件に「式に写せない」の目印が付く', () => {
    const text = chapter('workshop');

    expect(text).toMatch(/INV-C-002[\s\S]*?形式\n式に写せない/);
  });

  it('access_spec と action_spec の標識が、章の文脈にインラインで引用される', () => {
    const text = chapter('workshop');

    expect(text).toContain('下書きも意図的に全公開とする。');
    expect(text).toContain('- 公開の取り消しは用意しない。');
    expect(text).toContain('domain/workshop/access.md に残された手書きの判断');
  });

  it('この集約を読む query の一覧を持つ(併読は (併読) と示す)', () => {
    const text = chapter('workshop');
    const member = chapter('member');

    expect(text).toContain('workshop_list — 読むロール: member / 返し方: many');
    expect(member).toContain('workshop_detail(併読) — 読むロール: member / 返し方: one');
  });
});

describe('集約の章(HTML): 状態機械を持たない集約', () => {
  it('遷移表・マトリクス・操作の表は無く、データの節だけになる', () => {
    const text = chapter('member');

    expect(text).toContain('集約 member');
    expect(text).toContain('id | uuid');
    expect(text).not.toContain('遷移表');
    expect(text).not.toContain('マトリクス —');
    expect(text).not.toContain('操作(誰が・いつ・何を)');
  });
});
