/**
 * **機械的に作った敵対的な文章の集まり**を、本物の VitePress の描画器に通す(`book-render.test.ts` の手書きの例が見落とす並びを機械で探す)。
 *
 * 生成した章の文法(段落・見出し・箇条書き・1〜3 セルの表の行)と、敵対的な断片(バッククォートの連なり 1〜3・自動リンクされる URL・
 * 引用符つきの link title・`\`・`|`・`{{ }}`・`{ v-html=1}`・タグ)の 1〜3 個の並びの全部を掛け合わせる。無害化を通した描画の結果に、
 * フェンスの外の `{{`(インラインコードの中も含む)・危険な属性・危険な href・生の script が残らないこと。
 * 無害化はインラインコードを読み分けない(処理系との解釈の食い違いを抜け道にしない)ので、どの並びでも同じ結果になる。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { createBookRenderer, hasForbiddenAttribute, VITEPRESS_ENTRY, type MarkdownRender } from '../../helpers/vitepress-render.js';

/** 敵対的な断片。 */
const FRAGMENTS: readonly string[] = [
  '`',
  '``',
  '```',
  '\\`',
  'see https://x.y/',
  '[a](http://x "`")',
  "[a](http://x '`')",
  '[a](<http://x> "|")',
  '|',
  '\\',
  '{{ 1+1 }}',
  '{ v-html=1}',
  '{v-html=1}',
  '&#123;{ 1 }',
  '<script>alert(1)</script>',
  '<a href="jav&#x61;script:alert(1)">x</a>',
];

/** 生成した章の文法 1 つ分の文章にする(断片を並べた 1 組から)。 */
const GRAMMAR: ReadonlyArray<readonly [string, (parts: readonly string[]) => string]> = [
  ['段落', (parts) => parts.join(' ')],
  ['見出し', (parts) => `## ${parts.join(' ')}`],
  ['箇条書き', (parts) => `- ${parts.join(' ')}`],
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

/** 文字参照を戻す(href の判定用)。 */
function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:Tab|NewLine);/gi, '');
}

let render: MarkdownRender = () => '';

beforeAll(async () => {
  render = (await createBookRenderer()) ?? render;
});

describe.skipIf(!existsSync(VITEPRESS_ENTRY))('文法 × 敵対的な断片の機械的な集まり', () => {
  const corpus = GRAMMAR.flatMap(([name, build]) => sequences().map((parts) => ({ name, source: build(parts) })));

  it('集まりの大きさ(何も試さないまま緑にならない)', () => {
    expect(corpus.length).toBeGreaterThan(20_000);
  });

  it('描画結果の、フェンス(<pre>)の外に {{ が無く、危険な属性・href・生の script が無い', () => {
    const failures: string[] = [];
    for (const { name, source } of corpus) {
      const html = render(sanitizeBookMarkdown(source)).replace(/<pre[\s\S]*?<\/pre>/g, '');
      const hrefs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((match) => decode(match[1] ?? '').replace(/[\s\u0000-\u001F]/g, '').toLowerCase());
      const bad =
        html.includes('{{') ||
        /<(script|iframe)\b/i.test(html) ||
        hasForbiddenAttribute(html) ||
        hrefs.some((value) => /^(javascript|data|vbscript):|^[\\/]{2}|\\/.test(value));
      if (bad) failures.push(`${name}: ${JSON.stringify(source)}`);
      if (failures.length >= 10) break;
    }

    expect(failures).toEqual([]);
  });
});
