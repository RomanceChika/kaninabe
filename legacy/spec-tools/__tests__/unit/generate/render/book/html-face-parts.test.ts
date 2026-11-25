/**
 * 人向けの表示の部品の HTML 版(`html/face-parts.ts`)のテスト。
 *
 * クラス名が Markdown 版・VitePress の部品と同じこと(見た目を face.css が決めるため)・仕様の文字列が構造にならないこと・
 * 折りたたみが script なしで開け閉めできる `<details>` であることを見る。
 */

import { describe, expect, it } from 'vitest';

import { fold, grid, kv, mono, pts, term } from '../../../../../lib/generate/render/book/html/face-parts.js';

const HOSTILE = '<img src=x onerror=alert(1)>';

describe('face-parts', () => {
  it('等幅・ラベル行・箇条は Markdown 版と同じクラスで、文字列を逃がす', () => {
    expect(mono(HOSTILE)).toBe('<span class="bf-mono">&#60;img src=x onerror=alert(1)&#62;</span>');
    expect(kv('主語', HOSTILE)).toContain('<div class="bf-k">主語</div><div class="bf-v">&#60;img');
    expect(pts(['a', HOSTILE], true)).toMatch(/^<ul class="bf-pts bf-blk"><li>a<\/li><li>&#60;img/);
  });

  it('語釈は台帳にある語だけツールチップにする', () => {
    const glossary = (id: string): string | undefined => (id === 'axiom' ? HOSTILE : undefined);
    expect(term(glossary, 'axiom', '公理')).toContain('<span class="bf-term-tip" role="tooltip">&#60;img');
    expect(term(glossary, 'other', '語')).toBe('<span>語</span>');
  });

  it('折りたたみは <details> で、既定で開くものは印を持ち、中身が無ければ出さない', () => {
    const html = fold({ kind: 'sign', title: HOSTILE, count: 3, open: true, element: 'test' as never }, ['中身']) ?? '';
    expect(html).toMatch(/^<details class="bf-fold" data-kind="sign" open data-default-open="true" data-el="test">/);
    expect(html).not.toContain('<img');
    expect(fold({ kind: 'detail', title: 't' }, [])).toBeNull();
  });

  it('4 枚は印・見出し・数・中身を持つ', () => {
    const html = grid([{ id: 'axiom', label: '必読', mark: 'axiom', value: '3', body: [pts(['x'])] }]);
    expect(html).toContain('<span class="bf-mark bf-mark--axiom">必読</span>');
    expect(html).toContain('<div class="bf-cell-v">3</div>');
  });
});
