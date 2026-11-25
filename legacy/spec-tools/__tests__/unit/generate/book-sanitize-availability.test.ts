/**
 * ハンドブックの無害化の**可用性**(サイトの Vue のコンパイルを壊させない・処理が膨らまない)の単体テスト。
 *
 * 注入ではなく「ページが開けなくなる / 生成が止まる」を仕様の文字列だけから起こさせない: 重複した属性・`:::` の容器・スロットの重複と `#default` の混在・
 * 処理の手数(線形であること・予算を超えたら通すタグを無くして名指しで止めること)。描画の結果の判定は `book-oracle*.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { collectValidTags } from '../../../lib/generate/book-sanitize-balance.js';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { allowedTag } from '../../../lib/kernel/html-allow-list.js';
import { createTrusted } from '../../../lib/kernel/trusted-html.js';

const Z = '​';

/** 空の登録簿で無害化する。 */
const plain = (source: string): string => sanitizeBookMarkdown(source, createTrusted());

describe('重複した属性のタグは通さない(Vue のコンパイルが落ちる)', () => {
  it.each([
    ['class が 2 回', '<span class="a" class="b">x</span>'],
    ['大文字小文字違い', '<b id="x" ID="y">z</b>'],
    ['CLASS と class', '<span CLASS="a" class="b">x</span>'],
    ['値の無い属性', '<div hidden hidden>x</div>'],
    ['data-*', '<a data-x="1" data-x="2">x</a>'],
    ['画像の src', '<img src="a.png" src="b.png">'],
  ])('%s', (_name, source) => {
    expect(plain(source)).toContain(`<${Z}`);
  });

  it('重複の無いタグは通る。属性が多すぎるタグは通さない', () => {
    expect(plain('<span class="a" data-x="1" title="t">x</span>')).toBe('<span class="a" data-x="1" title="t">x</span>');
    const many = Array.from({ length: 41 }, (_unused, index) => `data-a${index}="1"`).join(' ');

    expect(allowedTag(`<span ${many}>`, 0, createTrusted())).toBeNull();
    expect(allowedTag(`<span ${many.split(' ').slice(0, 40).join(' ')}>`, 0, createTrusted())).not.toBeNull();
  });
});

describe('タグの中に改行を許さない(行の状態がずれ、次の行頭の > が引用になって対が割れる)', () => {
  it.each([
    ['属性の後', '<span class="a"\n>x</span>'],
    ['名前の後', '<div\n>x</div>'],
    ['属性の間', '<b\n  class="a">x</b>'],
    ['= の前後', '<b class\n=\n"a">x</b>'],
    ['引用符の値の中', '<b title="a\nb">x</b>'],
    ['閉じタグの中', '<b>x</b\n>'],
    ['空要素', '<br\n>'],
    ['自己閉じ', '<img src="a.png"\n/>'],
  ])('%s: 段落でも、表のセルでも、見出しでも、タグとして通さない', (_name, tag) => {
    for (const source of [`head\n${tag}`, `head\n\n| a |\n|--|\n| ${tag} |`, `head\n\n# ${tag}`, `text ${tag} text\n> quote`]) {
      const out = plain(source);

      expect(out, source).toContain(`<${Z}`);
      expect(out, source).not.toMatch(/<(span|div|b|br|img)[^<]*\n/);
    }
  });

  it('allowedTag は改行を含むタグを読まない。空白とタブは読む', () => {
    expect(allowedTag('<span class="a"\n>', 0, createTrusted())).toBeNull();
    expect(allowedTag('<span\tclass="a"\t>', 0, createTrusted())).not.toBeNull();
    expect(allowedTag('<span class = "a" >', 0, createTrusted())).not.toBeNull();
  });

  it('行末の文章の次が > で始まる行でも、行の状態はずれない(隣り合う引用の行の前で対が閉じている)', () => {
    expect(plain('text <b>x</b>\n> quote\n<i>y</i>')).toBe('text <b>x</b>\n> quote\n<i>y</i>');
  });
});

describe('VitePress の容器(:::)', () => {
  it.each(['::: tip', '::: details', '::: v-pre', '::: code-group', ':::', '::::', '  :::', '> ::: warning', '- ::: tip'])('%s は割る(3 つ以上続く : の間に零幅の文字)', (line) => {
    const out = plain(`head\n${line}\nbody\n:::`);

    expect(out).not.toMatch(/:::/);
  });

  it('2 つ以内の : は変えない。2 回掛けても増えない', () => {
    expect(plain('a: b :: c')).toBe('a: b :: c');
    expect(plain(plain(':::tip'))).toBe(plain(':::tip'));
  });

  it('容器の行はタグの積みを区切る(容器をまたぐ対は通さない)', () => {
    const out = plain('head\n\n<div>\n\n:::\n\n</div>');

    expect(out).toContain(`<${Z}div>`);
    expect(out).toContain(`<${Z}/div>`);
  });
});

describe('スロット(部品の中の <template #名前>)', () => {
  const component = (inner: string): string => `head\n\n<Fold kind="x">\n\n${inner}\n\n</Fold>\n`;
  const slot = (name: string, body = 'y'): string => `<template #${name}>\n\n${body}\n\n</template>`;

  it('名前の違うスロットは通る。#default だけも通る。#default と名前つきの併用も通る', () => {
    for (const inner of [`${slot('a')}\n\n${slot('b')}`, slot('default'), `${slot('default')}\n\n${slot('a')}`]) {
      expect(plain(component(inner)), inner).toBe(component(inner));
    }
  });

  it('同じ名前のスロットが 2 つある部品は、部品ごと通さない', () => {
    const out = plain(component(`${slot('a')}\n\n${slot('a', 'z')}`));

    expect(out).not.toMatch(/<(Fold|template|\/Fold|\/template)/);
  });

  it('#default と、スロットの外の中身を混ぜた部品は通さない(空白だけなら通る)', () => {
    expect(plain(component(`${slot('default')}\n\n余分な文章`))).not.toMatch(/<(Fold|template)/);
    expect(plain(component(`余分な文章\n\n${slot('default')}`))).not.toMatch(/<(Fold|template)/);
    expect(plain(component(`${slot('a')}\n\n余分な文章`))).toMatch(/<Fold/);
  });

  it('スロットの名前の無い <template> は通さない', () => {
    expect(plain(component('<template>\n\ny\n\n</template>'))).not.toMatch(/<(template|\/template)/);
  });
});

describe('手数の予算(超えたら通すタグを無くす)', () => {
  it('予算を小さくすると超える。通すタグは無く、無害化は問題を名指して載せる(書き込みの出口が止める)', () => {
    const source = 'head\n\n<div>\n\n本文 <b>強調</b> と `code` と {x}\n\n</div>\n'.repeat(50);
    const registry = createTrusted();

    expect(collectValidTags(source, [], registry, 0).exhausted).toBe(true);
    expect(collectValidTags(source, [], registry, 0).valid.size).toBe(0);
    const out = sanitizeBookMarkdown(source, registry, 0);

    expect(out).not.toMatch(/<[a-z/]/);
    expect(registry.problems.join('\n')).toContain('手数の予算');
    expect(registry.problems).toHaveLength(1);
  });

  it('既定の予算では、普通の文章は超えない', () => {
    const registry = createTrusted();
    const source = 'head\n\n<div>\n\n本文 <b>強調</b> と `code` と {x}\n\n</div>\n'.repeat(50);

    expect(sanitizeBookMarkdown(source, registry)).toBe(source);
    expect(registry.problems).toEqual([]);
  });
});
