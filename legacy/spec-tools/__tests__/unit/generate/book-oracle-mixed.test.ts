/**
 * **生成器が登録した断片と敵対的な仕様の文字列が入り混じった文書**を、Vue の構文木とコンパイルで判定する(種を固定した無作為な組み合わせ)。
 *
 * `book-oracle.test.ts` は登録の無い文書を見る。実際のページは、部品の見本・画面のプレビュー・コードの抜粋・図のフェンス・部品の式の属性が、
 * 仕様の文字列(閉じていない / 余分な許可表のタグ・`<template #名前>`・フェンス・強調・表)と同じページに並ぶ。登録した断片が仕様の文字列の構造を壊さず、
 * 仕様の文字列が登録した断片の構造を壊さないこと(注入が無く、Vue のコンパイルが通ること)を見る。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { fencedBlock, registerQuotedFences } from '../../../lib/generate/render/fenced.js';
import { resetTrusted, serializeJsonAttr, sliceTrusted, trustJsonAttr, trustSnippet } from '../../../lib/kernel/trusted-html.js';
import { FUZZ_SEED, HOSTILE, seededRandom, STRUCTURE, variableSeed } from '../../helpers/book-fuzz.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

/** 部品の式の属性の値(生成器の直列化に登録を足したもの)。 */
const jsonAttr = (value: unknown): string => trustJsonAttr(serializeJsonAttr(value));

const available = existsSync(VITEPRESS_ENTRY);

/** 件数。 */
const MIXED_CASES = 12_000;

/** 登録する断片(生成器が登録する 5 つの種類)。 */
function registeredSnippets(): readonly string[] {
  return [
    // 部品の見本(複数行の HTML ブロック)
    trustSnippet('<div class="parts-demo-item">\n<p class="parts-demo-item-title">見本</p>\n<span class="bf-mono">x</span>\n</div>'),
    // 実装が描いた画面のプレビュー(1 行・フォーム部品を含む)
    trustSnippet('<div class="screen-preview" inert><form><label>名前<input type="text" name="title" value="a"></label><button type="submit">送る</button></form></div>'),
    // コードの抜粋(式と生のタグを含む本文を、本文より長い柵で囲む)
    trustSnippet('````ts\nconst a = `{{ x }}`; // <script>alert(1)</script>\n```\n````'),
    // 図のフェンス
    trustSnippet('```mermaid\nflowchart LR\n  A["a < b"] --> B\n```'),
    // 部品とスロット(式の属性の値は生成器の直列化で登録する)
    trustSnippet(`<Steps :items='${jsonAttr([{ id: 'a', label: '一' }])}'>\n\n<template #a>\n\n中身\n\n</template>\n\n</Steps>`),
    // 本文の標識の引用の中のコードの柵(引用の記号つき。生のタグを含む)
    quotedFence(['```yaml', 'a: <script>alert(1)</script>', '```'], '> '),
    // 生成器の柵(中身に生のタグ・ハンドラ)
    fencedBlock('text', ['<img src=x onerror=alert(1)>', '```', 'b']),
  ];
}

/** 引用の記号つきの柵を登録して、その文字列を返す。 */
function quotedFence(lines: readonly string[], prefix: string): string {
  registerQuotedFences(lines, prefix);
  return lines.map((line) => `${prefix}${line}`).join('\n');
}

/** Markdown の HTML ブロックとして完結する行（続く行を飲み込む。登録した柵の直前に来うる）。 */
const COMPLETE_HTML_BLOCK_LINES: readonly string[] = ['<div>x</div>', '<p>x</p>', '<details>x</details>', '<table><tr><td>x</td></tr></table>', '<ul><li>x</li></ul>', '<!-- c -->', '<section>x</section>'];

/** 仕様の文字列の側の語彙の追加(登録した断片と同じ綴りの断片的な一部・近い形)。 */
const NEAR_MISSES: readonly string[] = [
  '<div class="parts-demo-item">', '</div>', '<form>', '</form>', '````ts', '````', '```mermaid', '<Steps>', '</Steps>', '<template #a>', '</template>',
  '<span class="bf-mono">x</span>', '<div class="screen-preview" inert>',
];

describe.skipIf(!available)('登録した断片 × 敵対的な文字列が入り混じった文書(種を固定した無作為な組み合わせ)', () => {
  let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });
  let snippets: readonly string[] = [];

  beforeAll(async () => {
    audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
    resetTrusted();
    snippets = registeredSnippets();
  });

  /** 種と件数を決めて文書を作り、判定が赤になったものを集める。 */
  const run = (seed: number, cases: number): string[] => {
    const random = seededRandom(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const failures: string[] = [];
    for (let index = 0; index < cases; index += 1) {
      const count = 3 + Math.floor(random() * 9);
      const lines: string[] = [];
      for (let line = 0; line < count; line += 1) {
        const roll = random();
        if (roll < 0.28) {
          // 生成器の書き方: 前後を空行で挟んだ断片
          lines.push('', pick(snippets), '');
        } else if (roll < 0.34) {
          // 直前が HTML ブロックとして完結する行（空行なしで登録した断片が続く）
          lines.push(pick(COMPLETE_HTML_BLOCK_LINES), pick(snippets));
        } else if (roll < 0.36) {
          // 空行無しで隣り合う断片
          lines.push(pick(snippets));
        } else if (roll < 0.62) {
          lines.push(pick(STRUCTURE) + (random() < 0.4 ? pick(HOSTILE) : ''));
        } else if (roll < 0.72) {
          lines.push(pick(NEAR_MISSES) + (random() < 0.3 ? pick(HOSTILE) : ''));
        } else {
          lines.push(pick(HOSTILE) + (random() < 0.2 ? ` ${pick(HOSTILE)}` : ''));
        }
      }
      const source = lines.join('\n');
      const { issues } = audit(source);
      if (issues.length > 0) failures.push(`種 ${seed}: ${JSON.stringify(source)} → ${issues[0]}`);
      if (failures.length >= 10) break;
    }
    return failures;
  };

  it(`種 ${FUZZ_SEED} で ${MIXED_CASES} 件。注入が無く、Vue のコンパイルが通る`, () => {
    expect(run(FUZZ_SEED, MIXED_CASES)).toEqual([]);
  }, 600_000);

  it('第 2 の種で 3000 件(別の種は環境変数 FUZZ_SEED で手で試す)', () => {
    expect(run(variableSeed(), 3_000)).toEqual([]);
  }, 600_000);

  it('登録した断片だけの文書は、そのまま(注入ではなく)通る', () => {
    const { issues, html } = audit(`見出し\n\n${snippets.join('\n\n')}\n`);

    expect(issues).toEqual([]);
    expect(html).toContain('parts-demo-item');
    expect(html).toContain('screen-preview');
    expect(html).toContain('<input');
  });

  it('別の生成器が登録した断片は、この生成器のページでは例外にならない(登録簿は生成器ごとに切り出す)', () => {
    const registry = resetTrusted();
    const first = registry.log.length;
    const preview = trustSnippet('<div class="screen-preview" inert><form><input type="text" name="title"></form></div>');
    const other = sliceTrusted(registry, registry.log.length);
    const own = sliceTrusted(registry, first);

    expect(sanitizeBookMarkdown(preview, own)).toContain('<input');
    expect(sanitizeBookMarkdown(preview, other)).not.toContain('<input');
    resetTrusted();
    snippets = registeredSnippets();
  });

  it('登録の無い同じ文字列は、登録した断片のようには通らない(登録簿が例外を決める)', () => {
    resetTrusted();

    const { html } = audit(snippets.join('\n\n'));

    // フォーム部品は許可表に無い。登録があったときだけ生のまま出る
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
    resetTrusted();
    snippets = registeredSnippets();
  });
});
