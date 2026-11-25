/**
 * 本の 1 ページ(HTML の文書全体)の器。
 *
 * 構成は、上の帯(入口と手引きへの導線・表示モード・暗い面)、
 * 左に「この章の見出し」、右に本文、下に前後の章。クラス名は `.bf-shell` ほかで、見た目は `face.css` がそのまま決める。
 *
 * 頭には CSP を置く(`script-src 'self'`。インラインの script は無い)。読む資材は同じ本の `assets/` だけで、外のフォントも読まない。
 * 文字列はすべて出力の口(`markup.ts`)を通す。**アプリの語彙は 1 語も持たない。**
 */

import { cspMeta, deferredScript, el, join, markup, stylesheet, url, type Html } from './markup.js';

/** 見出し 1 つ(目次の行)。 */
export interface PageHeading {
  readonly level: 2 | 3;
  /** 本文の見出しの `id`(`#` を付けずに)。 */
  readonly id: string;
  /** 見出しの中身(件数・印を含む HTML)。 */
  readonly title: Html;
}

/** 前後の章 1 件。 */
export interface PageLink {
  /** このページから見た相対の URL。 */
  readonly href: string;
  readonly title: string;
}

/** ページ 1 枚の材料。 */
export interface BookPage {
  /** 本の根から見たファイルの位置(例: `spec/item.html`)。資材への相対の URL をここから決める。 */
  readonly file: string;
  /** 文書の題(`<title>` と、目次の先頭)。 */
  readonly title: string;
  /** 本の題(`<title>` の後半)。 */
  readonly bookTitle: string;
  /** 本文(`<h1>` から)。 */
  readonly body: Html;
  readonly headings: readonly PageHeading[];
  readonly previous?: PageLink;
  readonly next?: PageLink;
  /** 表示モードの切り替えを出すか(折りたたみのあるページだけ)。 */
  readonly modes: boolean;
}

/** 器の語(仕組みの語)。 */
const WORDS = {
  skip: '章の中身へ',
  home: 'ハンドブックの入口へ',
  guide: 'レビューの手引き',
  toc: 'この章の見出し',
  theme: 'ダーク',
  previous: '前の章',
  next: '次の章',
  bar: 'ハンドブック',
  pager: '前後の章',
  modeGroup: '表示モード',
  modes: [
    ['brief', 'ざっくり'],
    ['full', 'くわしく'],
    ['sign', 'レビューする'],
  ],
} as const;

/** 本文の `id`。 */
const MAIN_ID = 'bf-main';

/** 生成物であることの宣言(HTML の注釈。定数)。 */
const GENERATED = markup`<!-- このファイルは全体が生成物である(npm run generate が全置換する)。手で編集しない。 -->`;

/** CSP(値は `markup.ts` の `BOOK_CSP`。`book:open` の応答の見出しも同じ値)。 */
const CSP = cspMeta();

/** このページから本の根への相対の前置き(`spec/item.html` → `../`)。 */
export function rootPrefix(file: string): string {
  const depth = file.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** 資材の読み込み(本の根からの位置は定数。前置きは `./` か `../` の繰り返しだけ)。 */
function assetLinks(prefix: string): string {
  // 前置きは rootPrefix が作る `./` / `../` だけで、仕様の文字列は入らない。URL の口を通して属性に置く。
  const css = ['assets/tokens.css', 'assets/ui.css', 'assets/face.css'];
  return [...css.map((path) => stylesheet(url(`${prefix}${path}`))), deferredScript(url(`${prefix}assets/book.js`))].join('');
}

/** 上の帯。 */
function bar(page: BookPage, prefix: string): Html {
  const atHome = page.file === 'index.html';
  return el(
    'header',
    { class: 'bf-bar', 'data-root': prefix },
    el(
      'nav',
      { class: 'bf-bar-links', 'aria-label': WORDS.bar },
      atHome ? null : el('a', { class: 'bf-bar-link', href: url(`${prefix}index.html`) }, WORDS.home),
      el('a', { class: 'bf-bar-link', href: url(`${prefix}review-guide.html`) }, WORDS.guide),
    ),
    el(
      'div',
      { class: 'bf-bar-tools' },
      page.modes
        ? el(
            'div',
            {
              class: 'bf-mode',
              role: 'group',
              'aria-label': WORDS.modeGroup,
              hidden: true,
            },
            WORDS.modes.map(([mode, label]) =>
              el(
                'button',
                {
                  type: 'button',
                  class: 'bf-mode-button',
                  'data-mode': mode,
                  'aria-pressed': 'false',
                },
                label,
              ),
            ),
          )
        : null,
      el(
        'button',
        {
          type: 'button',
          class: 'bf-theme',
          'aria-pressed': 'false',
          hidden: true,
        },
        WORDS.theme,
      ),
    ),
  );
}

/** 左の目次。 */
function toc(page: BookPage): Html {
  return el(
    'aside',
    { class: 'bf-aside' },
    el(
      'details',
      { class: 'bf-toc-box', open: true },
      el('summary', { class: 'bf-toc-summary' }, WORDS.toc),
      el(
        'nav',
        { class: 'bf-toc', 'aria-label': WORDS.toc },
        el(
          'ol',
          null,
          el('li', { class: 'g' }, el('a', { href: url(`#${MAIN_ID}`) }, page.title)),
          page.headings.map((heading) => el('li', { class: heading.level === 2 ? 'g' : 'i' }, el('a', { href: url(`#${heading.id}`) }, heading.title))),
        ),
      ),
    ),
  );
}

/** 前後の章。 */
function pager(page: BookPage): Html | null {
  if (page.previous === undefined && page.next === undefined) return null;
  const link = (item: PageLink | undefined, kind: 'prev' | 'next', label: string): Html | null =>
    item === undefined
      ? null
      : el(
          'a',
          {
            class: ['bf-pager-link', `bf-pager-${kind}`],
            href: url(item.href),
          },
          el('span', { class: 'bf-pager-label' }, label),
          el('span', { class: 'bf-pager-title' }, item.title),
        );
  return el('nav', { class: 'bf-pager', 'aria-label': WORDS.pager }, link(page.previous, 'prev', WORDS.previous), link(page.next, 'next', WORDS.next));
}

/**
 * ページ 1 枚の HTML の文書。
 *
 * @param page ページの材料
 */
export function renderPage(page: BookPage): string {
  const prefix = rootPrefix(page.file);
  const head = join([
    markup`<meta charset="utf-8">`,
    markup`<meta name="viewport" content="width=device-width, initial-scale=1">`,
    CSP,
    el('title', null, `${page.title} | ${page.bookTitle}`),
  ]);
  const body = el(
    'div',
    { class: 'bf-shell' },
    el('a', { class: 'bf-skip', href: url(`#${MAIN_ID}`) }, WORDS.skip),
    bar(page, prefix),
    el('div', { class: 'bf-page' }, toc(page), el('main', { id: MAIN_ID, class: 'bf-main', tabindex: -1 }, el('div', { class: ['vp-doc', 'bf-doc'] }, page.body), pager(page))),
  );
  return `<!doctype html>\n${GENERATED}\n<html lang="ja" class="bf-html">\n<head>${head}${assetLinks(prefix)}</head>\n<body>${body}</body>\n</html>\n`;
}
