/**
 * 生成器が登録した**柵**（`fencedBlock` の柵と、`registerQuotedFences` の引用つき・リストの中の柵）の、**直前の行の文脈**。
 *
 * 直前の行が Markdown の HTML ブロックとして完結する行（`<div>x</div>` ほか）だと、続く行はその HTML ブロックに飲まれ、柵と中身が生の HTML になる
 * （`<script>` が SFC に巻き上げられ、`<img onerror>` が生で出る）。無害化は、登録された柵（引用 `>`・リスト記号つきも）の前に空行を置く。
 * 前の行 × 中身 × 柵の種類を、本物の VitePress の描画器と Vue の構文木・コンパイルで判定する。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { fencedBlock, registerQuotedFences } from '../../../lib/generate/render/fenced.js';
import { resetTrusted, trustSnippet } from '../../../lib/kernel/trusted-html.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

const available = existsSync(VITEPRESS_ENTRY);

/** 直前の行（HTML ブロックとして完結する行・CRLF 終わり・表・リスト・引用・見出し・段落・容器・コメント）。 */
const PREVIOUS_LINES: ReadonlyArray<readonly [string, string]> = [
  ['div', '<div>x</div>'],
  ['p', '<p>x</p>'],
  ['details', '<details>x</details>'],
  ['table', '<table><tr><td>x</td></tr></table>'],
  ['ul', '<ul><li>x</li></ul>'],
  ['div（CRLF 終わり）', '<div>x</div>\r'],
  ['comment', '<!-- c -->'],
  ['表の行', '| a |\n|--|\n| b |'],
  ['リスト', '- item'],
  ['引用', '> quote'],
  ['見出し', '# title'],
  ['段落', 'text'],
  ['容器', '::: tip'],
  ['字下げのコード', '    code'],
  ['空', ''],
];

/** 柵の中身（生のタグ・ハンドラ・式）。 */
const CONTENTS: readonly string[] = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '{{ 1 + 1 }}', '</div>', '<style>x</style>'];

/** 登録した柵を文書の中に置く 4 つの作り方（柵の種類）。 */
const KINDS: ReadonlyArray<readonly [string, (content: string) => string]> = [
  ['fencedBlock', (content) => fencedBlock('text', ['a', content, 'b'])],
  [
    '引用つきの柵',
    (content) => {
      const lines = ['```yaml', content, '```'];
      registerQuotedFences(lines, '> ');
      return lines.map((line) => `> ${line}`).join('\n');
    },
  ],
  [
    'リストの項目の中の引用つきの柵',
    (content) => {
      // 1 行目だけ項目の記号、続く行は項目の字下げ（柵が項目の中で続く形）
      const block = ['- > ```yaml', `  > ${content}`, '  > ```'].join('\n');
      return trustSnippet(block);
    },
  ],
  [
    '~~~ の引用つきの柵',
    (content) => {
      const lines = ['~~~', content, '~~~'];
      registerQuotedFences(lines, '> ');
      return lines.map((line) => `> ${line}`).join('\n');
    },
  ],
];

describe.skipIf(!available)('登録した柵の直前の行の文脈 × 中身 × 柵の種類（描画の判定は Vue の構文木とコンパイル）', () => {
  let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });

  beforeAll(async () => {
    audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
  });

  it(`${PREVIOUS_LINES.length} 種の直前の行 × ${CONTENTS.length} 種の中身 × ${KINDS.length} 種の柵: 生の HTML にならず、コンパイルも通る`, () => {
    const failures: string[] = [];
    for (const [kindName, build] of KINDS) {
      for (const content of CONTENTS) {
        for (const [previousName, previous] of PREVIOUS_LINES) {
          resetTrusted();
          const fenced = build(content);
          const result = audit(`head\n\n${previous}\n${fenced}\nafter\n`);
          const code = result.html.includes('<code>') || result.html.includes('<pre');
          if (result.issues.length > 0) failures.push(`${kindName} × ${JSON.stringify(content)} × ${previousName} → ${result.issues[0]}`);
          else if (!code) failures.push(`${kindName} × ${JSON.stringify(content)} × ${previousName} → 柵がコードにならなかった`);
        }
      }
    }
    resetTrusted();

    expect(failures).toEqual([]);
  });

  it('前の行が HTML ブロックのとき、無害化は登録した柵の前に空行を置く（引用つき・リストの中も）', () => {
    for (const [name, build] of KINDS) {
      resetTrusted();
      const fenced = build('x');
      const out = sanitizeBookMarkdown(`<div>x</div>\n${fenced}\n`);

      expect(out, name).toContain(`<div>x</div>\n\n${fenced.split('\n')[0]}`);
    }
    resetTrusted();
  });

  it('前の行が空行なら、空行を足さない（出力が膨らまない）', () => {
    resetTrusted();
    const fenced = fencedBlock('text', ['a']);
    const source = `head\n\n${fenced}\n`;

    expect(sanitizeBookMarkdown(source)).toBe(source);
    resetTrusted();
  });
});
