/**
 * 本の HTML のページの器(`html/page.ts`)と、新しい形の章の本文(`html/spec-chapter.ts`)・流れの図(`html/flow-diagram.ts`)のテスト。
 *
 * 器: CSP があり、script は同じ本の資材の 1 本だけ(インラインは無い)・資材への相対の前置き・目次の並び。
 * 本文: 仕様の文字列が構造にならないこと(状態の名前・遷移の名前に敵対的な文字列を入れる)・図が区分のクラスを持つこと。
 */

import { describe, expect, it } from 'vitest';
import { el } from '../../../../../lib/generate/render/book/html/markup.js';
import { renderPage, rootPrefix } from '../../../../../lib/generate/render/book/html/page.js';
import { flowDiagram } from '../../../../../lib/generate/render/book/html/flow-diagram.js';
import type { LifecycleFacts } from '../../../../../lib/semantics/spec-book/lifecycle-facts.js';

const HOSTILE = '<img src=x onerror=alert(1)>{{ 1 }}';
const source = { file: 'x' };

const facts: LifecycleFacts = {
  aggregate: 'thing',
  machine: 'thing',
  initial: 'a',
  steps: 2,
  states: [
    { id: 'a', label: '始め', category: 'start', final: false, settles: [], step: 1 },
    { id: 'b', label: HOSTILE, category: 'done', final: true, settles: [], step: 2 },
    { id: 'x', label: 'やめ', category: 'negative', final: true, settles: [] },
  ],
  transitions: [
    { key: 'go', id: 'go', label: HOSTILE, from: ['a'], to: 'b', by: ['owner'], autonomy: 'human', origins: [], fromAnywhere: false, source },
    { key: 'stop', id: 'stop', label: 'やめる', from: ['a'], to: 'x', by: ['owner'], autonomy: 'human', origins: [], fromAnywhere: false, source },
  ],
  source,
} as unknown as LifecycleFacts;

describe('renderPage', () => {
  const html = renderPage({
    file: 'spec/thing.html',
    title: HOSTILE,
    bookTitle: '本',
    body: el('h1', null, HOSTILE),
    headings: [{ level: 2, id: 'flow', title: el('span', null, '流れ') }],
    next: { href: './other.html', title: HOSTILE },
    modes: true,
  });

  it('CSP を持ち、script は同じ本の資材の 1 本だけ', () => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">`);
    expect(html.match(/http-equiv/g)).toHaveLength(1);
    expect(html.indexOf('http-equiv')).toBeLessThan(html.indexOf('<title>'));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script src="../assets/book.js" defer></script>');
  });

  it('仕様の文字列は題・本文・前後の章のどこでも構造にならない', () => {
    expect(html).not.toContain('<img');
    expect(html.match(/&#60;img src=x onerror=alert\(1\)&#62;/g)).toHaveLength(4);
  });

  it('資材への前置きはページの深さで決まる', () => {
    expect(rootPrefix('index.html')).toBe('./');
    expect(rootPrefix('spec/a.html')).toBe('../');
  });

  it('目次は見出しを本文と同じ順で持つ', () => {
    expect(html).toContain('<li class="g"><a href="#flow"><span>流れ</span></a></li>');
  });
});

describe('flowDiagram', () => {
  const figure = flowDiagram(facts, '図の説明') ?? '';

  it('節は区分のクラスを持ち、終点は印を持つ', () => {
    expect(figure).toContain('class="bf-fl-node bf-state--start"');
    expect(figure).toContain('class="bf-fl-node bf-state--done bf-state--final"');
    expect(figure).toContain('class="bf-fl-node bf-state--negative bf-state--final"');
  });

  it('状態と遷移の名前は SVG の字として逃がされる', () => {
    expect(figure).not.toContain('<img');
    expect(figure).toContain('2/2 &#60;img src=x onerror=alert(1)&#62;{{ 1 }}');
  });

  it('状態が無ければ図を出さない', () => {
    expect(flowDiagram({ ...facts, states: [], transitions: [] }, '図')).toBeNull();
  });
});
