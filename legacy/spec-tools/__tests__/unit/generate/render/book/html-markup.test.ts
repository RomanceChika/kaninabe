/**
 * 本の HTML の出力の口(`render/book/html/markup.ts`)のテスト。
 *
 * 本文・属性の値・URL の 3 文脈で、仕様の文字列が HTML の構造にならないこと。点検 3〜5 回目の反例(SVG の animate の `javascript:`・
 * 特殊な閉じ方の注釈・`{{ }}`・取り込み記法・文字参照で化ける URL)をそのまま当てる。
 */

import { describe, expect, it } from 'vitest';
import { el, join, markup, text, url, type Html, deferredScript, stylesheet } from '../../../../../lib/generate/render/book/html/markup.js';

/** 点検で使った敵対的な文字列。 */
const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  '--!><script>alert(1)</script>',
  '<!--><img src=x onerror=alert(1)>-->',
  '{{ [].constructor.constructor("alert(1)")() }}',
  '<<< @/../../etc/passwd',
  '" onmouseover="alert(1)',
  "' autofocus onfocus='alert(1)",
  '</td></tr></table><script>alert(1)</script>',
  '`<b>x</b>`',
  '&lt;script&gt;',
];

describe('本文', () => {
  it.each(HOSTILE)('仕様の文字列は文字として出る: %s', (value) => {
    const html = el('p', null, value);
    expect(html).not.toMatch(/<(?!\/?p>)/);
    expect(html.slice(3, -4)).not.toMatch(/[<>"']/);
  });

  it('text と子の文字列は同じ逃がし方をする', () => {
    expect(el('span', null, text('a<b'))).toBe(el('span', null, 'a<b'));
  });

  it('as Html で偽った文字列は、実行時に本文として逃がされる', () => {
    const forged = '<script>alert(1)</script>' as Html;
    expect(el('div', null, forged)).toBe('<div>&#60;script&#62;alert(1)&#60;/script&#62;</div>');
  });

  it('口が作った断片は入れ子にできる', () => {
    expect(el('ul', null, [el('li', null, 'a'), el('li', null, 'b')])).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(join([el('b', null, 'x'), 'y'], markup`<br>`)).toBe('<b>x</b><br>y');
  });

  it('中身を持たないタグに子は置けない', () => {
    expect(() => el('br', null, 'x')).toThrow();
  });
});

describe('属性', () => {
  it.each(HOSTILE)('値は二重引用符の中で逃がされる: %s', (value) => {
    const html = el('span', { title: value, 'data-x': value }, 'x');
    expect(html).toMatch(/^<span title="[^"<>']*" data-x="[^"<>']*">x<\/span>$/);
  });

  it('型の許可表の外の属性は、型をすり抜けても書けない', () => {
    for (const name of ['onclick', 'onerror', 'style', 'srcdoc', 'ONLOAD', 'formaction', 'xlink:href']) {
      const attrs = { [name]: 'alert(1)' } as unknown as Parameters<typeof el>[1];
      expect(() => el('span', attrs, 'x'), name).toThrow();
    }
  });

  it('class は並びを空白で繋ぎ、偽の値を落とす', () => {
    expect(el('span', { class: ['a', false, null, 'b'] }, 'x')).toBe('<span class="a b">x</span>');
  });
});

describe('URL', () => {
  it.each(['./spec/a.md', '../b.html#x', '#top', 'a/b', 'https://example.org/?q=1&r=2', 'mailto:a@example.org'])('許可表の中: %s', (value) => {
    expect(url(value)).toBe(value);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'java​script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://example.org',
    '//evil.example',
    '/\\evil.example',
  ])('許可表の外は作れない: %s', (value) => {
    expect(() => url(value)).toThrow();
  });

  it('文字参照は属性の中で実体参照になり、化けない', () => {
    expect(el('a', { href: url('jav&#x61;script&colon;alert(1)') }, 'x')).toBe('<a href="jav&#38;#x61;script&#38;colon;alert(1)">x</a>');
  });

  it('SafeUrl を偽って href に置いても、書くときに許可表で止まる', () => {
    const forged = 'javascript:alert(1)' as ReturnType<typeof url>;
    expect(() => el('a', { href: forged }, 'x')).toThrow();
  });
});

describe('属性の名前とタグの実行時の表(点検 13 回目 C13-1・C13-9)', () => {
  it.each(['data-x onclick', 'data-x=1', 'data-X', 'data-', 'aria-x onclick', 'aria-x1', 'onclick', 'style', 'srcdoc', 'formaction', 'data-x"'])('属性の名前 %j は書けない', (name) => {
    expect(() => el('div', { [name]: '1' }, 'x')).toThrow(`書けない属性: ${name}`);
  });

  it.each(['data-x', 'data-a1-b', 'aria-label'])('属性の名前 %j は書ける', (name) => {
    expect(el('div', { [name]: '1' }, 'x')).toBe(`<div ${name}="1">x</div>`);
  });

  it.each(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'template', 'foreignObject', 'animate', 'use', 'image', 'link', 'meta', 'base', 'svg onload=1'])('タグ %j は型をすり抜けても書けない', (tag) => {
    expect(() => el(tag as 'div', null, 'x')).toThrow(`書けないタグ: ${tag}`);
  });

  it('頭の script / link の字面と同じ文字列は、本文で逃がされる(断片として素通りしない)', () => {
    const script = deferredScript(url('./assets/book.js'));
    const link = stylesheet(url('./assets/ui.css'));
    expect(script).toBe('<script src="./assets/book.js" defer></script>');
    expect(el('p', null, script)).not.toContain('<script');
    expect(el('p', null, link)).not.toContain('<link');
  });
});

describe('定数', () => {
  it('markup は置換を持てない', () => {
    const call = markup as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Html;
    expect(() => call(Object.assign(['<b>', '</b>'], { raw: ['<b>', '</b>'] }), 'x')).toThrow();
  });
});
