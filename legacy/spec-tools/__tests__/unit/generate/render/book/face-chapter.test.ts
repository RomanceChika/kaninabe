/**
 * 人向けの表示の章の共通の部品(`face-chapter.ts` / `face-budget.ts`)のテスト。
 *
 * 固定するのは**形**である: 読む量の中身の部品(数の出どころは呼ぶ側)・上段の行の印と公理の種類・下段の折りたたみの種類。
 * 製品の語は 1 つも出てこない。
 */

import { describe, expect, it } from 'vitest';
import { pendingWords, readerLines } from '../../../../../lib/generate/render/book/face-budget.js';
import { axiomRowHtml, items } from '../../../../../lib/generate/render/book/face-chapter.js';
import { fold, kv, term } from '../../../../../lib/generate/render/book/face-html.js';
import type { ReadingSum } from '../../../../../lib/generate/render/book/block-reading.js';

/** 読む量の合計(読み手ごと)。 */
function sum(overrides: Partial<ReadingSum> = {}): ReadingSum {
  return {
    axioms: 12,
    reasoned: 3,
    pending: 2,
    changed: null,
    byReader: {
      business: { axioms: 12, reasoned: 2, pending: 1 },
      developer: { axioms: 0, reasoned: 1, pending: 1 },
    },
    ...overrides,
  };
}

describe('4 枚の中身の部品', () => {
  it('読み手ごとの 2 行は、必読(公理 + 受け入れ)と受け入れの件数(理由つき + まだ通していない)を言う', () => {
    const lines = readerLines(sum(), { business: '業務の言葉で読む', developer: '構造の警告を含む' });

    expect(lines).toEqual(['業務 15 件。受け入れ 3 件。業務の言葉で読む', '開発者 2 件。受け入れ 2 件。構造の警告を含む']);
  });

  it('まだ通していない分が引けていなければ「未集計」(0 とは書かない)', () => {
    expect(pendingWords(null)).toContain('未集計');
    expect(pendingWords(0)).toBe('まだ通していない分 0 件');
  });
});

describe('上段の行と見出し', () => {
  it('公理の行は宣言の単位 1 つで印は 1 つ。載せる公理の種類(読み方の表の鍵)を data-el に残し、飛び先の id を持てる', () => {
    const html = axiomRowHtml('<span>a</span>', [kv('どこへ', '連絡')], ['notification.audience', 'notification.summary'], 'a-1');

    expect(html).toContain('class="bf-axiom" id="a-1" data-el="notification.audience notification.summary"');
    expect(html.match(/bf-mark--axiom/g)).toHaveLength(1);
    expect(html).toContain('<div class="bf-k">どこへ</div>');
  });

  it('id を持たない行は id 属性を出さない', () => {
    expect(axiomRowHtml('x', [], ['job.summary'])).not.toContain(' id=');
  });

  it('下段の折りたたみは、載せる導出の種類を data-el に残す', () => {
    const text = fold({ kind: 'table', title: 't', count: 3, element: 'notification.source' }, ['body']).join('\n');

    expect(text).toContain('data-el="notification.source"');
    expect(fold({ kind: 'table', title: 't' }, ['body']).join('')).not.toContain('data-el');
  });

  it('下段の折りたたみは導出の種類しか受け取れない(公理の種類は型で書けない)', () => {
    // @ts-expect-error 公理の種類(job.summary)は、畳んで下段に置けない。
    const wrong = fold({ kind: 'table', title: 't', element: 'job.summary' }, ['body']);

    expect(wrong.join('')).toContain('data-el="job.summary"');
  });
});

describe('ツールチップと箇条', () => {
  it('用語のツールチップは辞書の id を属性に、文字をそのまま出す', () => {
    expect(term('axiom', '公理')).toBe('<Term id="axiom">公理</Term>');
  });

  it('箇条のセルは表を割る | を実体参照にする', () => {
    expect(items(['a|b', 'c'])).toBe('<ul class="bf-pts"><li>a&#124;b</li><li>c</li></ul>');
  });
});
