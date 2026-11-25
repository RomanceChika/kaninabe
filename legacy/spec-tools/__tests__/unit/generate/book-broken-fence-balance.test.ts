/**
 * **割った行頭の柵とコードスパンの対**: 釣り合いの追跡は、出力と同じ文字列の上で行う(種 63854354 の乱択が見つけた穴)。
 *
 * 無害化は、登録外の行頭の ``` を `` `<ZWSP>`<ZWSP>` `` に割る(仕様の文字列は柵を開けない)。割る前は、行頭の ``` が同じ行の次の ``` とコードスパンの対になるが、
 * 割った後は 1 字ずつの連なりになり、`` `<ZWSP>` `` が 1 つのコードスパンになって、残りの ``` は**別の**連なりと対になる。
 * 釣り合いの追跡が割る前の文字列を読むと、対だと数えた `<details>` … `</details>` の片方だけが、出力ではコードスパンに飲まれて文字になる
 * (`` ``` ```<details>```>```</details> `` → 開きはコードの中・閉じは生のタグ → Vue のコンパイルの誤り「Invalid end tag」でサイトのビルドが落ちる)。
 * 直しは、行頭の柵を割る・登録した柵の前に空行を置くという**文字列を変える処理を釣り合いの追跡より前に**済ませ、追跡が出力と同じ文字列を読むこと。
 *
 * 判定は本物の VitePress の描画器と Vue の構文木・コンパイル(注入と、コンパイルの誤り)。
 */

import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { fencedBlock } from '../../../lib/generate/render/fenced.js';
import { resetTrusted } from '../../../lib/kernel/trusted-html.js';
import { createBookAudit, VITEPRESS_ENTRY, type BookAudit } from '../../helpers/vitepress-render.js';

const available = existsSync(VITEPRESS_ENTRY);

/** 乱択が見つけた元の文書(種 63854354 の 6036 件目)。 */
const ORIGINAL =
  'head\n```x"v-html="1"]# ```:::</Fold></table><img src="a.png">]<template #a><template #a>x</template></dl><details>```x"y> <summary><small><dd></section>```x"v-html="1"<img src="a.png">    </details><Fold kind="x"><template #a>!---)';

/** 字の単位で削った最小の文書。 */
const MINIMAL = 'head\n``` ```<details>```>```</details>';

/** 行頭の前置き(字下げ・引用・リスト)。 */
const PREFIXES: readonly string[] = ['', '  ', '> ', '- ', '1. '];

/** 行頭の柵の連なりと、同じ行で割る前の文字列と対になる相手。 */
const OPENINGS: readonly string[] = ['``` ```', '```x```', '```` ````', '```x"y ```', '~~~ ```', '```'];

/** 許可表のタグの対の前・間・後に置くバッククォートの形。 */
const TICKS: readonly string[] = ['', '`', '``', '```', '```>```', '`x`', '``x``'];

/** 許可表のタグの対(インラインと HTML ブロックの名前と部品)。 */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['<details>', '</details>'],
  ['<b>', '</b>'],
  ['<Fold kind="x">', '</Fold>'],
];

describe.skipIf(!available)('割った行頭の柵とコードスパンの対(本物の描画器と Vue のコンパイル)', () => {
  let audit: (source: string, options?: { readonly sanitize?: boolean }) => BookAudit = () => ({ sanitized: '', html: '', issues: [] });

  beforeAll(async () => {
    audit = (await createBookAudit((source) => sanitizeBookMarkdown(source))) ?? audit;
    resetTrusted();
  });

  it.each([
    ['乱択が見つけた元の文書', ORIGINAL],
    ['最小の文書', MINIMAL],
  ])('%s: 注入が無く、Vue のコンパイルが通る', (_name, source) => {
    expect(audit(source).issues).toEqual([]);
  });

  it(`前置き ${PREFIXES.length} × 柵 ${OPENINGS.length} × タグの対 ${PAIRS.length} × 前・間・後のバッククォート ${TICKS.length}³: 注入もコンパイルの誤りも無い`, () => {
    const failures: string[] = [];
    for (const prefix of PREFIXES) {
      for (const opening of OPENINGS) {
        for (const [open, close] of PAIRS) {
          for (const before of TICKS) {
            for (const inside of TICKS) {
              for (const after of TICKS) {
                const source = `head\n${prefix}${opening}${before}${open}${inside}${close}${after}\n\ntail`;
                const { issues } = audit(source);
                if (issues.length > 0) failures.push(`${JSON.stringify(source)} → ${issues[0]}`);
              }
            }
          }
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([]);
  }, 600_000);

  it('登録した柵の前に足す空行も、釣り合いの追跡が読む(段落とコードスパンの続きが出力と同じ所で切れる)', () => {
    const failures: string[] = [];
    for (const [open, close] of PAIRS) {
      for (const before of ['', '`', '```', 'x `']) {
        for (const after of ['', '`', '```', '` y']) {
          const registry = resetTrusted();
          const block = fencedBlock('text', ['code']);
          const source = `head\n${before}${open}x\n${block}\n${after}${close}\n\ntail`;
          const { issues } = audit(sanitizeBookMarkdown(source, registry), { sanitize: false });
          if (issues.length > 0) failures.push(`${JSON.stringify(source)} → ${issues[0]}`);
        }
      }
    }
    resetTrusted();

    expect(failures).toEqual([]);
  });

  it('無害化しないと最小の文書は赤になる(判定者が見ている)', () => {
    expect(audit('head\n``` ```<details>```>```</details>\n```x"y\ncode\n```', { sanitize: false }).issues.length).toBeGreaterThan(0);
  });
});
