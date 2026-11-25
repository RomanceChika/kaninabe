/**
 * **行頭の形 × 特殊文字**の総当たりを、本物の VitePress の描画器と Vue のコンパイルで判定する(注入の無さと、コンパイルが落ちないこと)。
 *
 * VitePress 自身が仕様の文字列を属性に**エスケープせずに**書く所がある(コードの柵の情報文字列を `class="language-…"` と `<span class="lang">` に書く)。
 * 仕様の文字列が行頭で柵を開けると、引用符を含む情報文字列で属性が壊れ、Vue のコンパイルが落ちてドキュメントのビルドが止まる。無害化は行頭の ``` と ~~~ の連なりを割る
 * (生成器の柵は登録簿の完全一致で通る)。見出しの id・リンクの題・容器の題・参照の定義・表・引用・リストも、同じ特殊文字で確かめる。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { fencedBlock } from '../../../lib/generate/render/fenced.js';
import { resetTrusted } from '../../../lib/kernel/trusted-html.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

const available = existsSync(VITEPRESS_ENTRY);
const Z = '​';

/** 特殊文字（引用符・山括弧・文字参照・バックスラッシュ・バッククォート・タブ・属性の注入の試み）。 */
const SPECIALS: readonly string[] = [
  '"', "'", '<', '>', '&#34;', '&quot;', '&#x22;', '\\', '`', '\t', '&#61;', '=', '"v-html="1"', '" onclick="x', '" :items="[1]', "' @click='x", '{#app}', '{{ 1 }}', '<b>', '</div>', '\\"', '$',
];

/** 行頭の形（`{S}` が特殊文字に置き換わる）。 */
const CONSTRUCTS: ReadonlyArray<readonly [string, string]> = [
  ['``` の柵と情報文字列', '```x{S}y\ncode\n```'],
  ['~~~ の柵と情報文字列', '~~~x{S}y\ncode\n~~~'],
  ['4 つの柵', '````x{S}y\ncode\n````'],
  ['情報文字列だけ', '```{S}'],
  ['情報文字列の後ろ', '```js {S}\ncode\n```'],
  ['字下げした柵', '  ```x{S}y\ncode\n  ```'],
  ['引用の中の柵', '> ```x{S}y\n> code\n> ```'],
  ['リストの中の柵', '- ```x{S}y\n  code\n  ```'],
  ['番号リストの中の柵', '1. ~~~x{S}y\n   code\n   ~~~'],
  ['ATX 見出しとアンカー', '# T {S} {#id}'],
  ['ATX 見出し（2 段目）', '## {S}'],
  ['setext 見出し', 'T {S}\n====='],
  ['引用', '> {S}'],
  ['表の行', '| a |\n|--|\n| {S} |'],
  ['表の見出し', '| {S} |\n|--|\n| a |'],
  ['容器', '::: tip {S}\nbody\n:::'],
  ['v-pre の容器', '::: v-pre\n{S}\n:::'],
  ['リンク参照の定義と題', '[a]: http://x "{S}"\n\n[a]'],
  ['リンク参照の定義と URL', '[a]: <u{S}v>\n\n[a]'],
  ['リンクの題', '[a](http://x "{S}")'],
  ['リンクの URL', '[a](http://x/{S})'],
  ['画像の代替文字', '![{S}](http://x/a.png)'],
  ['リスト', '- {S}'],
  ['番号つきリスト', '1. {S}'],
  ['入れ子のリスト', '- a\n  - {S}'],
  ['HTML ブロックの始まり', '<div>{S}</div>'],
  ['HTML コメント', '<!-- {S} -->'],
];

describe.skipIf(!available)('行頭の形 × 特殊文字（本物の描画器と Vue のコンパイル）', () => {
  let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });

  beforeAll(async () => {
    resetTrusted();
    audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
  });

  it(`${CONSTRUCTS.length} 形 × ${SPECIALS.length} 文字: コンパイルの誤りも注入も無い`, () => {
    const failures: string[] = [];
    for (const [name, template] of CONSTRUCTS) {
      for (const special of SPECIALS) {
        const source = `head\n\n${template.split('{S}').join(special)}\n\ntail\n`;
        const { issues } = audit(source);
        if (issues.length > 0) failures.push(`${name} × ${JSON.stringify(special)} → ${issues[0]}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('前後の文脈（直前が段落・HTML ブロック・表・リスト）が違っても同じ', () => {
    const failures: string[] = [];
    for (const before of ['text', '<div>x</div>', '| a |\n|--|\n| b |', '- item', '> quote', '    indented', '<b>x</b>', '']) {
      for (const special of SPECIALS) {
        const { issues } = audit(`${before}\n\`\`\`x${special}y\ncode\n\`\`\`\n~~~x${special}y\n~~~\nafter`);
        if (issues.length > 0) failures.push(`${JSON.stringify(before)} × ${JSON.stringify(special)} → ${issues[0]}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('無害化しないと、引用符を含む情報文字列で Vue のコンパイルが落ちる（判定者が見ている）', () => {
    expect(audit('head\n\n```x"y\ncode\n```\n', { sanitize: false }).issues.length).toBeGreaterThan(0);
    expect(audit('head\n\n~~~x"v-html="1"\ncode\n~~~\n', { sanitize: false }).issues.length).toBeGreaterThan(0);
  });
});

describe('行頭の柵の連なりを割る（仕様の文字列は柵を開けない）', () => {
  const plain = (source: string): string => sanitizeBookMarkdown(source, resetTrusted());

  it.each([
    ['```x"y', `\`${Z}\`${Z}\`x"y`],
    ['~~~x"y', `~${Z}~${Z}~x"y`],
    ['````x', `\`${Z}\`${Z}\`${Z}\`x`],
    ['  ```x', `  \`${Z}\`${Z}\`x`],
    ['> ```x', `> \`${Z}\`${Z}\`x`],
    ['- ~~~x', `- ~${Z}~${Z}~x`],
    ['1. ```x', `1. \`${Z}\`${Z}\`x`],
  ])('%s', (source, expected) => {
    expect(plain(`head\n${source}`)).toBe(`head\n${expected}`);
  });

  it('行の途中の連なり・2 つ以下の連なり・コードスパンは変えない。2 回掛けても増えない', () => {
    expect(plain('a ```b``` c')).toBe('a ```b``` c');
    expect(plain('``code`` と `x`')).toBe('``code`` と `x`');
    expect(plain(plain('```x\n~~~y'))).toBe(plain('```x\n~~~y'));
  });

  it('生成器が登録した柵は通る（中身の連なりより長い柵・前に空行）', () => {
    const registry = resetTrusted();
    const block = fencedBlock('text', ['+-- a', '```', '  b']);
    const out = sanitizeBookMarkdown(`見出し\n${block}\n`, registry);

    expect(block.startsWith('````text\n')).toBe(true);
    expect(out).toContain(block);
    expect(out).toContain('\n\n````text');
    resetTrusted();
  });
});
