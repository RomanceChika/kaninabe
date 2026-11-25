/**
 * **Vue の構文木を判定者にした**無害化の検査(字面の検索ではない)。
 *
 * 本物の VitePress の描画器で描いた HTML を、Vue が読むのと同じ手順で構文木にして、`v-pre` の外の補間・登録された部品以外の式の属性・`on*`・危険な URL・
 * 危険なタグが無いことを見る(`__tests__/helpers/vitepress-render.ts` の `createBookAudit`)。次の 3 つ:
 *   1. 監査が実測した迂回の再現(コメント・タグの属性の中の `{{`・インラインコード・表・字下げのコード・`:items` の文字参照での引用符抜け ほか)
 *   2. 文法 × 敵対的な断片の機械的な集まり(1 行の文章)
 *   3. 構造の行(字下げ 0〜3 のフェンス・HTML ブロックの始まり・コメント・引用・リスト・表・見出し・setext)× 敵対的な行 の 2〜8 行の文書の無作為な組み合わせ
 *      (**種を固定**した乱数。同じ種なら同じ文書の列)
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { serializeJsonAttr, trustJsonAttr } from '../../../lib/kernel/trusted-html.js';
import { FUZZ_SEED, HOSTILE, seededRandom, STRUCTURE, variableSeed } from '../../helpers/book-fuzz.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

/** 部品の式の属性の値(生成器の直列化に登録を足したもの)。 */
const jsonAttr = (value: unknown): string => trustJsonAttr(serializeJsonAttr(value));

let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });

beforeAll(async () => {
  audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
});

const available = existsSync(VITEPRESS_ENTRY);

/** 文書の無作為な組み合わせの数。 */
const FUZZ_CASES = 12_000;

describe.skipIf(!available)('監査が実測した迂回(判定者は Vue の構文木)', () => {
  it.each([
    ['インラインコードの中のコメント', '`<!-- {{ 1+1 }} -->`'],
    ['インラインコードの中のタグの属性', '`<a title="{{ 1+1 }}">x</a>`'],
    ['表のセルの中のタグの属性', '| h |\n|--|\n| <a title="{{ 1+1 }}">x</a> |'],
    ['表のセルの中のコード', '| h |\n|--|\n| `<a title="{{1}}">` |'],
    ['字下げ 4 のコードの中のコメント', 'para\n\n    <!-- {{ 1+1 }} -->\n    {{ 1+1 }}'],
    ['字下げ 4 のコードの中のタグ', '    <a title="{{ 1+1 }}">x</a>'],
    ['字下げ 1〜3 のフェンス', ' ```\n{{ 1+1 }}\n ```'],
    ['字下げ 3 の ~~~ フェンス', '   ~~~\n{{ 1+1 }}\n   ~~~'],
    ['<pre> の HTML ブロック', '<pre>\n{{ 1+1 }}\n</pre>'],
    ['段落の行頭のインラインタグ', '<b>x</b> {{ 1+1 }}\n{{ 1+1 }}'],
    ['フェンスの後の行', '```\nx\n```\n{{ 1+1 }}'],
    ['title の中の {{', '<a href="/x" title="{{ 1+1 }}">x</a>'],
    ['コメントの中の {{', '<!-- {{ 1+1 }} -->'],
    ['コメントを閉じてタグ', '<!-- x --><script>alert(1)</script>'],
    ['文字参照の {', '&#123;{ 1+1 }}'],
    ['属性の記法', 'text {v-html="1"}'],
    ['段落の中の改行入りのタグ(属性の後)', 'head\n<span class="a"\n>x</span>'],
    ['段落の中の改行入りのタグ(名前の後)', 'head\ntext <div\n>x</div>'],
    ['改行入りのタグの次の行頭が >', 'head\n<b\n>x</b>\n> quote'],
    ['表のセルの中の改行入りのタグ', 'head\n\n| a |\n|--|\n| <b\n>x</b> |'],
    ['見出しの中の改行入りのタグ', 'head\n\n# <b\n>x</b>'],
    ['引用の値の中の改行', 'head\n<b title="a\nb">x</b>'],
    ['行末の文字の次が > で始まる行', 'head\ntext <b>x</b>\n> y'],
    ['零幅の文字を挟んだ { の後の空白と # で id を付ける', 'head\nx { #app}'],
    ['重複した属性(class)', '<span class="a" class="b">x</span>'],
    ['重複した属性(大文字小文字違い)', '<b id="x" ID="y">z</b>'],
    ['重複した属性(値の無い属性)', '<div hidden hidden>x</div>'],
    ['重複した属性(data-*)', '<a data-x="1" data-x="2">x</a>'],
    ['容器の中に開いて外で閉じる', 'head\n::: tip\n<div>\n:::\n\n</div>'],
    ['容器の外で開いて中で閉じる', 'head\n<div>\n\n::: tip\n\n</div>\n\n:::'],
    ['容器の中の部品', 'head\n::: details\n<Fold kind="x">\n:::\n\n</Fold>'],
    ['v-pre の容器', 'head\n::: v-pre\n{{ 1 + 1 }}\n:::'],
    ['スロットの名前の重複', 'head\n\n<Fold kind="x">\n\n<template #a>\n\ny\n\n</template>\n\n<template #a>\n\nz\n\n</template>\n\n</Fold>'],
    ['#default と他の中身', 'head\n\n<Fold kind="x">\n\n<template #default>\n\ny\n\n</template>\n\nextra\n\n</Fold>'],
  ])('%s', (_name, source) => {
    expect(audit(source).issues).toEqual([]);
  });

  describe('部品の式の属性(:items / :cells)', () => {
    it('生成器が jsonAttr で出した値は、部品の式の属性として残る', () => {
      const result = audit(`<Steps :items='${jsonAttr([{ id: 'a', label: 'ラベル' }])}'>\n\n<template #a>\n\n中身\n\n</template>\n\n</Steps>\n`);

      expect(result.issues).toEqual([]);
      expect(result.html).toContain(':items');
    });

    it.each([
      ['&#34; で引用符を抜ける', `<Steps :items='[{&#34;id&#34;:&#34;a&#34;}] .constructor.constructor(&#34;alert(1)&#34;)()'>`],
      ['&#x22; で引用符を抜ける', `<Steps :items='[1]&#x22;.constructor.constructor(&#x22;alert(1)&#x22;)()'>`],
      ['JSON として正しいが Vue が復号すると式になる', `<Steps :items='["a&#34;],alert(1),[&#34;"]'>`],
      ['式そのもの', `<Grid :cells='alert(1)'>`],
      ['登録されていない JSON', `<Grid :cells='[1,2,3]'>`],
      ['二重引用符で囲んだ式', `<Steps :items="[1]">`],
      ['登録された値に式を継ぎ足す', `<Steps :items='${jsonAttr([1])}.constructor'>`],
    ])('%s', (_name, source) => {
      const result = audit(source);

      expect(result.issues).toEqual([]);
      expect(result.html).not.toMatch(/<(Steps|Grid)\b/);
    });
  });
});

/** 文法 × 断片の集まりの断片。 */
const FRAGMENTS: readonly string[] = [
  '`', '``', '```', '\\`', 'see https://x.y/', '[a](http://x "`")', "[a](http://x '`')", '|', '\\', '{{ 1+1 }}', '{ v-html=1}', '{v-html=1}', '&#123;{ 1 }',
  '<script>alert(1)</script>', '<a href="jav&#x61;script:alert(1)">x</a>', '<!-- {{ 1 }} -->', '<a title="{{ 1 }}">x</a>', '<img src=x onerror=1>',
  '<div>', '</div>', '<template #x>', '</template>',
];

const GRAMMAR: ReadonlyArray<readonly [string, (parts: readonly string[]) => string]> = [
  ['段落', (parts) => parts.join(' ')],
  ['見出し', (parts) => `## ${parts.join(' ')}`],
  ['箇条書き', (parts) => `- ${parts.join(' ')}`],
  ['引用', (parts) => `> ${parts.join(' ')}`],
  ...[1, 2, 3].map((cells): readonly [string, (parts: readonly string[]) => string] => [
    `表の行(${cells} セル)`,
    (parts) => {
      const row = Array.from({ length: cells }, (_unused, column) => parts.filter((_part, index) => index % cells === column).join(' '));
      const head = Array.from({ length: cells }, () => 'h');
      return [`| ${head.join(' | ')} |`, `|${head.map(() => '--').join('|')}|`, `| ${row.join(' | ')} |`].join('\n');
    },
  ]),
];

/** 断片の 1〜3 個の並び(重複あり)の全部。 */
function sequences(): readonly (readonly string[])[] {
  const out: string[][] = [];
  for (const a of FRAGMENTS) {
    out.push([a]);
    for (const b of FRAGMENTS) {
      out.push([a, b]);
      for (const c of FRAGMENTS) out.push([a, b, c]);
    }
  }
  return out;
}

describe.skipIf(!available)('文法 × 敵対的な断片の機械的な集まり(1 行の文章)', () => {
  const corpus = GRAMMAR.flatMap(([name, build]) => sequences().map((parts) => ({ name, source: build(parts) })));

  it('集まりの大きさ(何も試さないまま緑にならない)', () => {
    expect(corpus.length).toBeGreaterThan(30_000);
  });

  it('どの文章も、Vue の構文木に注入が無い', () => {
    const failures: string[] = [];
    for (const { name, source } of corpus) {
      const { issues } = audit(source);
      if (issues.length > 0) failures.push(`${name}: ${JSON.stringify(source)} → ${issues[0]}`);
      if (failures.length >= 10) break;
    }

    expect(failures).toEqual([]);
  }, 600_000);
});

describe.skipIf(!available)('構造の行 × 敵対的な行の 2〜8 行の文書(種を固定した無作為な組み合わせ)', () => {
  it(`種 ${FUZZ_SEED} で ${FUZZ_CASES} 件。Vue の構文木に注入が無い`, () => {
    const random = seededRandom(FUZZ_SEED);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const failures: string[] = [];
    for (let index = 0; index < FUZZ_CASES; index += 1) {
      const count = 2 + Math.floor(random() * 7);
      const lines: string[] = [];
      for (let line = 0; line < count; line += 1) {
        lines.push(random() < 0.55 ? pick(STRUCTURE) + (random() < 0.4 ? pick(HOSTILE) : '') : pick(HOSTILE) + (random() < 0.2 ? ` ${pick(HOSTILE)}` : ''));
      }
      const source = lines.join('\n');
      const { issues } = audit(source);
      if (issues.length > 0) failures.push(`${JSON.stringify(source)} → ${issues[0]}`);
      if (failures.length >= 10) break;
    }

    expect(failures).toEqual([]);
  }, 600_000);

  it('第 2 の種で 4000 件(別の種は環境変数 FUZZ_SEED で手で試す)', () => {
    const seed = variableSeed();
    const random = seededRandom(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const failures: string[] = [];
    for (let index = 0; index < 4_000; index += 1) {
      const lines: string[] = [];
      for (let line = 0, count = 2 + Math.floor(random() * 9); line < count; line += 1) {
        lines.push(random() < 0.55 ? pick(STRUCTURE) + (random() < 0.4 ? pick(HOSTILE) : '') : pick(HOSTILE) + (random() < 0.2 ? ` ${pick(HOSTILE)}` : ''));
      }
      const source = lines.join('\n');
      const { issues } = audit(source);
      if (issues.length > 0) failures.push(`種 ${seed}: ${JSON.stringify(source)} → ${issues[0]}`);
      if (failures.length >= 10) break;
    }

    expect(failures).toEqual([]);
  }, 600_000);

  it('無害化しないと注入が出る(判定者が何も見ていないまま緑にならない)', () => {
    expect(audit('{{ 1+1 }}', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('<span class="a" class="b">x</span>', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('<script>alert(1)</script>', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('<a href="/x" onclick="alert(1)">x</a>', { sanitize: false }).issues.length).toBeGreaterThan(0);
  });
});
