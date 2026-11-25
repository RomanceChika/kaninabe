/**
 * 書式つきの本文を描く口への渡し方の走査(R15 の材料)のテスト。
 *
 * 抽出(純関数 `richTextSitesIn`)は「拾う形」と「拾わない形」を表で持ち、I/O 境界(`scanRichTextSites`)は
 * 一時ディレクトリに実ファイルを書いて実行する(ソースの根の下だけを走査する)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { richTextSitesIn, scanRichTextSites } from '../../../lib/risk/rich-text-scan.js';
import { sourceRootPath } from '../../../lib/model/product/layout.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';

/** 本物の描く口の import(拾う形の表に前置きする)。 */
const REAL = [
  "import { MarkdownView } from '@kaninabe/runtime/markdown-view';",
  "import { renderMarkdown, plainTextOf } from '@kaninabe/runtime/markdown';",
].join('\n');

const pick = (source: string) => richTextSitesIn(`${REAL}\n${source}`, 'f.tsx').map((site) => [site.sink, site.argument] as const);

describe('richTextSitesIn', () => {
  it.each([
    ['MarkdownView の value', '<MarkdownView value={row.body} />', [['MarkdownView', 'row.body']]],
    ['属性の順が違う', '<MarkdownView className={ui.prose} value={page.body} />', [['MarkdownView', 'page.body']]],
    ['改行をまたぐ属性', '<MarkdownView\n  className="x"\n  value={row.venue?.note}\n/>', [['MarkdownView', 'row.venue?.note']]],
    ['renderMarkdown の第 1 引数', 'const html = renderMarkdown(current.body);', [['renderMarkdown', 'current.body']]],
    ['plainTextOf の第 1 引数(第 2 引数は別)', 'plainTextOf(current.body, DESCRIPTION_LIMIT)', [['plainTextOf', 'current.body']]],
    ['呼び出しの結果を渡す(字面ごと残す)', 'renderMarkdown(trim(page.body))', [['renderMarkdown', 'trim(page.body)']]],
    ['加工した値を渡す(字面ごと残す)', '<MarkdownView value={a + b} />', [['MarkdownView', 'a + b']]],
    ['1 本に複数', '<MarkdownView value={a.x} /><MarkdownView value={b.y} />', [['MarkdownView', 'a.x'], ['MarkdownView', 'b.y']]],
  ])('拾う: %s', (_name, source, expected) => {
    expect(pick(source)).toEqual(expected);
  });

  it.each([
    ['value の無い使い方', '<MarkdownView />'],
    ['別の部品', '<MarkdownViewer value={row.body} />'],
    ['名前が似ているだけの関数', 'myrenderMarkdown(x); plainTextOfAll(y);'],
    ['文字だけの記述', '// MarkdownView に渡す'],
  ])('拾わない: %s', (_name, source) => {
    expect(pick(source)).toEqual([]);
  });
});

describe('richTextSitesIn: 名前でなく束縛で見る', () => {
  const raw = (source: string) => richTextSitesIn(source, 'f.tsx').map((site) => [site.sink, site.argument] as const);

  it('別名の import でも拾い、口の名前(正規名)で載せる', () => {
    expect(raw("import { MarkdownView as MV } from '@kaninabe/runtime/markdown-view'; import { renderMarkdown as rm } from '@kaninabe/runtime/markdown'; <MV value={a.b} />; rm(c.d);")).toEqual([
      ['MarkdownView', 'a.b'],
      ['renderMarkdown', 'c.d'],
    ]);
  });

  it.each([
    ['import が無い', '<MarkdownView value={row.body} />; renderMarkdown(row.body); plainTextOf(row.body);'],
    ['同名のローカル関数', 'function renderMarkdown(x: string) { return x; } renderMarkdown(row.body);'],
    ['同名のローカルコンポーネント', 'const MarkdownView = ({ value }: { value: string }) => <p>{value}</p>; <MarkdownView value={row.body} />;'],
    ['別モジュールの import', "import { renderMarkdown } from './my-markdown'; import { MarkdownView } from '@/components/md'; renderMarkdown(a.b); <MarkdownView value={a.b} />;"],
    ['正しいモジュールの別の export を別名で偽装', "import { excerptOf as renderMarkdown } from '@kaninabe/runtime/markdown'; renderMarkdown(a.b);"],
    ['引数で隠した名前', "import { renderMarkdown } from '@kaninabe/runtime/markdown'; const f = (renderMarkdown: (s: string) => string) => renderMarkdown(a.b);"],
    ['型だけの import', "import type { MarkdownView } from '@kaninabe/runtime/markdown-view'; <MarkdownView value={a.b} />;"],
    ['入れ子ブロックの var は関数スコープで隠す', "import { renderMarkdown } from '@kaninabe/runtime/markdown'; function f(a: { b: string }) { while (a.b) { var renderMarkdown = (s: string) => s; break; } return renderMarkdown(a.b); }"],
    ['ブロックの中の関数宣言も隠す(保守的)', "import { renderMarkdown } from '@kaninabe/runtime/markdown'; function f(a: { b: string }) { { function renderMarkdown(s: string) { return s; } } return renderMarkdown(a.b); }"],
  ])('拾わない: %s', (_name, source) => {
    expect(raw(source)).toEqual([]);
  });
});

describe('scanRichTextSites(実ファイル)', () => {
  let root = '';
  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('ソースの根の下のファイルから拾い、根の外は見ない', () => {
    root = mkdtempSync(join(tmpdir(), 'rich-text-scan-'));
    const src = sourceRootPath(TEST_LAYOUT, TEST_ROOTS);
    if (src === null) throw new Error('ソースの根が配置に無い');
    const write = (relative: string, text: string): void => {
      mkdirSync(dirname(join(root, relative)), { recursive: true });
      writeFileSync(join(root, relative), text);
    };
    write(`${src}/screens/a.tsx`, `${REAL}\n<MarkdownView value={row.body} />`);
    write(`${src}/lib/b.ts`, `${REAL}\nrenderMarkdown(x.note)`);
    write('scripts/c.ts', `${REAL}\nrenderMarkdown(y.other)`);

    const scan = scanRichTextSites(root, TEST_ROOTS, TEST_LAYOUT);

    expect(scan.available).toBe(true);
    expect(scan.sites.map((site) => `${site.file}|${site.argument}`).sort()).toEqual([`${src}/lib/b.ts|x.note`, `${src}/screens/a.tsx|row.body`]);
  });

  it('ソースの根が無ければ走査できない', () => {
    root = mkdtempSync(join(tmpdir(), 'rich-text-scan-'));
    expect(scanRichTextSites(root, TEST_ROOTS, TEST_LAYOUT)).toEqual({ available: false, sites: [] });
  });
});
