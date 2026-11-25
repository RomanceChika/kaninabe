/**
 * ハンドブックの Markdown の無害化(`lib/generate/book-sanitize.ts`)の単体テスト。
 *
 * 設計は**既定で拒否**: 全行の `{{` `}}` `{` と `<` を割る(フェンス・コメント・HTML ブロックの中も)。例外は、生成器が登録簿(`kernel/trusted-html.ts`)に
 * 登録した完全一致の文字列と、許可表のタグだけ。描画の結果の判定(Vue の構文木)は `book-oracle.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { createTrusted, resetTrusted, serializeJsonAttr, trustJsonAttr, trustSnippet, type TrustedHtml } from '../../../lib/kernel/trusted-html.js';

const Z = '​';

/** 空の登録簿で無害化する(登録簿の影響を受けない)。 */
const plain = (source: string): string => sanitizeBookMarkdown(source, createTrusted());

describe('既定で拒否: 全行の {{ と < を割る', () => {
  it('{{ }} は式として読まれない形にする(見出し・表・箇条書き・コード・コメントのどこでも)', () => {
    const hostile = "会議室{{ [].constructor.constructor('alert(1)')() }}";

    const out = plain([`# 集約 room(${hostile})`, `| ${hostile} |`, `- ${hostile}`, `\`${hostile}\``, '```', hostile, '```', `<!-- ${hostile} -->`].join('\n'));

    expect(out).not.toContain('{{');
    expect(out).toContain(`{${Z}{`);
  });

  it('フェンスの中も、コメントの中も、字下げのコードの中も割る(処理系の解釈に頼らない)', () => {
    // 仕様の文字列は行頭でコードの柵を開けない(柵の記号を割る)ので、柵の中の特別扱いは無く、中も外も同じに割る
    expect(plain('```ts\n{{ x }} <b>\n```')).toBe(`\`${Z}\`${Z}\`ts\n{${Z}{${Z} ${Z}x ${Z}}${Z}} <${Z}b>\n\`${Z}\`${Z}\``);
    expect(plain('<!-- {{ x }} -->')).toBe(`<${Z}!-- {${Z}{${Z} ${Z}x ${Z}}${Z}} -->`);
    expect(plain('    {{ x }}')).not.toContain('{{');
    expect(plain('  ```\n{{ 1 }}\n  ```')).not.toContain('{{');
    expect(plain('<pre>\n{{ 1 }}\n</pre>')).not.toContain('{{');
  });

  it.each([
    ['<script>alert(1)</script>'],
    ['<img src=x onerror=alert(1)>'],
    ['<iframe src="https://evil.example"></iframe>'],
    ['<style>body{display:none}</style>'],
    ['<pre>x</pre>'],
    ['<textarea>x</textarea>'],
    ['<form action="/x"><input name="a"></form>'],
    ['<a href="javascript:alert(1)">x</a>'],
    ['<a href=" JaVa\tScRiPt:alert(1)">x</a>'],
    ['<a href="//evil.example/x">x</a>'],
    ['<a href="\\\\evil.example/x">x</a>'],
    ['<div onclick="x()">'],
    ['<div v-html="x">'],
    ['<div @click="x()">'],
    ['<Grid :cells="alert(1)">'],
    ['<div style="background:url(//evil/?)">'],
    ['<div id="app">'],
    ['<img name="location" src="/x.png">'],
    ['<div\nonclick="x()">'],
    ['<!-- a --> <b>x</b> <!-- --><script>'],
  ])('%j は許可表を通らない: < の直後に零幅の文字を挟み、タグとして読まれなくする', (input) => {
    const out = plain(input);

    expect(out).not.toMatch(/<(script|iframe|style|pre|textarea|form|input|img|Grid)\b/);
    expect(out).not.toMatch(/<(a|div)\s+[^>]*(onclick|v-html|@click|style=|id="app"|href="(javascript|\/\/|\\))/);
    expect(out).not.toContain('<!--');
    expect(out).toContain(`<${Z}`);
  });

  it('許可表のタグの属性の値の中の {{ と < も割る', () => {
    const out = plain('<a href="/x" title="{{ 1+1 }} <b>">x</a>');

    expect(out).not.toContain('{{');
    expect(out).toContain('<a href="/x" title="');
    expect(out).not.toMatch(/title="[^"]*<b>/);
  });

  it('許可表の構造のタグ・部品・スロット・SVG は、釣り合いがとれていれば 1 バイトも変えない', () => {
    const legit = [
      '<div class="bf-card" data-testid="a" title="説明"><span class="bf-mono">room</span><br /></div>',
      '',
      '<Fold kind="axiom" count="3">',
      '',
      '<template #acceptance>',
      '',
      '中身',
      '',
      '</template>',
      '',
      '</Fold>',
      '',
      '<a href="/items/1" class="x">リンク</a> <a href="#見出し">内</a> <a href="https://example.com/">外</a>',
      '<img src="./assets/brand-icon.png" alt="ロゴ" width="40" height="40" />',
      '<div style="--swatch: var(--color-text);">x</div>',
      '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" marker-end="url(#a)" /></svg>',
      '<div class="screen-preview" inert data-preview-screen="x">y</div>',
      '<span id="marker-1">m</span>',
    ].join('\n');

    expect(plain(legit)).toBe(legit);
  });

  describe('釣り合い(仕様の文字列が作るタグでサイトの Vue のコンパイルを壊させない)', () => {
    it.each([
      ['閉じていない開き', '<div>x'],
      ['余分な閉じ', 'x</div>'],
      ['入れ違い', '<b><i>x</b></i>'],
      ['部品の閉じていない開き', '<Fold kind="x">x'],
      ['部品の余分な閉じ', 'x</Fold>'],
      ['単独の template(スロットの略記つき)', '<template #x>y</template>'],
      ['単独の template', '<template>y</template>'],
      ['単独の閉じ template', '</template>'],
      ['v-slot', '<Fold><template v-slot:x>y</template></Fold>'],
      ['部品の外のスロットの略記', '<div #x>y</div>'],
    ])('%s は通さない: < の直後に零幅の文字を挟む', (_name, source) => {
      const out = plain(source);

      expect(out).toContain(`<${Z}`);
      expect(out).not.toMatch(/<(template|\/template)\b/);
    });

    it('釣り合いのとれた対は、仕様の文字列でも通る(害の無い構造)', () => {
      expect(plain('<b>x</b> <div><span>y</span></div>')).toBe('<b>x</b> <div><span>y</span></div>');
    });

    it('部品の直下の <template #名前> は、ブロックの始まりの行(前が空行・行末までがそのタグ)で、部品の対が成り立つときだけ通る', () => {
      const block = '<Fold kind="x">\n\n<template #a>\n\ny\n\n</template>\n\n</Fold>';

      expect(plain(block)).toBe(block);
      // 同じ行に押し込んだ template は処理系がタグと読まない(`</template>` だけがタグになる)ので通さない
      expect(plain('<Fold kind="x"><template #a>y</template></Fold>')).toContain(`<${Z}template`);
      // 部品の対が成り立たなければ、その中の template も通さない
      expect(plain('<Fold kind="x">\n\n<template #a>\n\ny\n\n</template>')).not.toMatch(/<template|<\/template/);
      expect(plain('<Fold><template v-slot:a>y</template></Fold>')).toContain(`<${Z}template`);
    });

    it.each([
      ['複数行の対の開きが行の途中', 'text <div>\n\n</div>'],
      ['複数行の対の閉じが行の途中', '<div>\n\ntext</div>'],
      ['段落の中の強調の記号', '*<b>x*</b>'],
      ['段落の中のコード', '<b>`x</b>`'],
      ['段落の中の表の区切り', '| <b> | </b> |'],
      ['リンクの括弧', '[<b>](u)</b>'],
      ['打ち消しの記号', '~~<b>x~~</b>'],
      ['エスケープされた開き', '\\<b>x</b>'],
      ['字下げされた複数行の対', '  <div>\n  </div>'],
      ['リストの中の複数行の対', '- <div>\n  </div>'],
      ['コードスパンの中の表の区切り', '| <b>`a|b`</b> |'],
      ['フェンスの開きの行の情報文字列', '```<b>x</b>\ncode\n```'],
    ])('Markdown が対を別々の要素にまたがせる形は通さない: %s', (_name, source) => {
      expect(plain(source)).toMatch(new RegExp(`<${Z}`));
    });

    it('複数行でも、前が空行で行頭の対(HTML ブロック名)や、同じ行・同じ段落の記号の無い対は通る', () => {
      for (const source of ['<div>\n\n本文\n\n</div>', '<ul>\n<li>a</li>\n</ul>', 'a <b>b</b> c', '<b>x</b> and <i>y</i>', '> <b>x</b>', '- <i>x</i>', 'snake_case <b>x</b> a_b', '<ul><li>全部入りの `generate` が回して出す</li></ul>', '| <b>列</b> | <ul><li>`a` と ``b`` の説明</li></ul> |']) {
        expect(plain(source), source).toBe(source);
      }
    });
  });

  it('冪等(2 回通しても同じ)', () => {
    const once = plain('# {{ x }}\n<script>alert(1)</script> <div onclick="a"> a < b &#123;{ 1 }\n```\n<b> {{ 1 }}\n```');

    expect(plain(once)).toBe(once);
  });
});

describe('属性の記法 {…}', () => {
  it('{ の直後に零幅の文字を挟む(空白が続く形も)。例外は {n} だけ', () => {
    expect(plain('x {v-html=1} { v-html=1} {.cls} {#id}')).toBe(`x {${Z}v-html=1} {${Z} ${Z}v-html=1} {${Z}.cls} {${Z}#id}`);
    expect(plain('排他{n} と {画面名}')).toBe(`排他{n} と {${Z}画面名}`);
  });

  it('{ … } の中の空白の後ろにも挟む(markdown-it-attrs は零幅の文字を属性名の一部として読み、空白で属性を区切るので、どの属性名も零幅の文字で始める)', () => {
    expect(plain('x { #app}')).toBe(`x {${Z} ${Z}#app}`);
    expect(plain('x {a  #app  id=app}')).toBe(`x {${Z}a ${Z} ${Z}#app ${Z} ${Z}id=app}`);
    // `}` で終わる所まで。外の空白は変えない
    expect(plain('x {#a} y z')).toBe(`x {${Z}#a} y z`);
    // 2 回掛けても増えない
    expect(plain(plain('x { #app} {{ y }}'))).toBe(plain('x { #app} {{ y }}'));
  });

  it('見出しのアンカー {#id} も割る(生成器が出す見出しの行は完全一致で登録する)', () => {
    expect(plain('### jobs {#jobs}')).toBe(`### jobs {${Z}#jobs}`);
    const registry = createTrusted();
    registry.snippets.add('### jobs {#jobs}');

    expect(sanitizeBookMarkdown('### jobs {#jobs}\n### other {#jobs}', registry)).toBe(`### jobs {#jobs}\n### other {${Z}#jobs}`);
  });

  it('文字参照の { が次の { と隣り合って復号されるのを止める。生成器の esc の出力は変えない', () => {
    expect(plain('&#123;{ 1 }')).not.toMatch(/&#123;\{/);
    expect(plain('&#123;&#123; 1')).not.toContain('&#123;&#123;');
    expect(plain('&lbrace;&lcub;')).not.toContain('&lbrace;&lcub;');
    expect(plain('&#123;n&#125;')).toBe('&#123;n&#125;');
  });
});

describe('例外は生成器の登録だけ(完全一致。印は出力に無い)', () => {
  it('登録した文字列はそのまま出る(< と単独の { を変えない)。{{ と }} は割る', () => {
    const registry = createTrusted();
    const fence = '```mermaid\nflowchart LR\n  A{"x"} --> B<br/>y\n```';
    registry.snippets.add(fence);
    registry.snippets.add('<textarea class="control" rows="3">見本</textarea>');

    const out = sanitizeBookMarkdown(`${fence}\n\n<textarea class="control" rows="3">見本</textarea> {{ 1 }}\n\n<textarea>x</textarea>`, registry);

    expect(out).toContain(fence);
    expect(out).toContain('<textarea class="control" rows="3">見本</textarea>');
    expect(out).not.toContain('{{');
    expect(out).toContain(`<${Z}textarea>x`);
  });

  it('登録した文字列の中の {{ は割る', () => {
    const registry = createTrusted();
    registry.snippets.add('<b>{{ 1 }}</b> 見本です');

    expect(sanitizeBookMarkdown('<b>{{ 1 }}</b> 見本です', registry)).toBe(`<b>{${Z}{ 1 }${Z}}</b> 見本です`);
  });

  it('trustSnippet は短すぎる文字列を登録しない', () => {
    const before = createTrusted();
    expect(before.snippets.size).toBe(0);
    expect(trustSnippet('<b>')).toBe('<b>');
  });

  it('コメントは登録しない限りそのままでは出ない', () => {
    expect(plain('<!-- このファイルは全体が生成物である -->')).toContain(`<${Z}!--`);
    const registry = createTrusted();
    registry.snippets.add('<!-- このファイルは全体が生成物である -->');

    expect(sanitizeBookMarkdown('<!-- このファイルは全体が生成物である -->', registry)).toBe('<!-- このファイルは全体が生成物である -->');
  });
});

describe('部品の式の属性(:items / :cells)', () => {
  const registry: TrustedHtml = createTrusted();
  const value = serializeJsonAttr([{ id: 'a', label: "x'y&z" }, { label: '{{ 1 }} <b>' }]);
  registry.jsonAttrs.add(value);

  it('登録した値で、Vue と同じ復号で読み直した JSON を同じ直列化で書き直すと一致するものだけ通る', () => {
    const tag = `<Steps :items='${value}'></Steps>`;

    expect(sanitizeBookMarkdown(tag, registry)).toBe(tag);
    expect(value).not.toContain('{{');
  });

  it.each([
    ['文字参照 &#34; で引用符を抜ける', `<Steps :items='[1]&#34;.constructor'>`],
    ['&#x22;', `<Steps :items='[1]&#x22;.constructor'>`],
    ['JSON として正しいが復号すると式になる', `<Steps :items='["a&#34;],alert(1),[&#34;"]'>`],
    ['登録していない値', `<Grid :cells='[1,2,3]'>`],
    ['登録した値に継ぎ足す', `<Steps :items='${value}.constructor'>`],
    ['二重引用符', `<Steps :items="${value}">`],
    ['引用符なし', `<Steps :items=${value}>`],
  ])('%s は通さない', (_name, source) => {
    expect(sanitizeBookMarkdown(source, registry)).toContain(`<${Z}`);
  });

  it('登録のときに食い違い(配列でない・読み直しが一致しない)があれば登録簿の problems に載る(書き込みの出口が拒否する)', () => {
    const fresh = resetTrusted();
    trustJsonAttr(serializeJsonAttr([1, 'a']));
    expect(fresh.problems).toEqual([]);

    trustJsonAttr('{"a":1}');
    trustJsonAttr('[1]&#34;x');
    expect(fresh.problems).toHaveLength(2);
    resetTrusted();
  });
});
