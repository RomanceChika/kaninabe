/**
 * ハンドブックの無害化(`generate/book-sanitize.ts`。`.md` の出力だけの経路で、本の HTML には掛からない)と画面プレビューの検査(`generate/render/book/preview-check.ts`)が使う、通すタグの許可表と、タグ 1 つの検査(純粋関数)。
 *
 * 通すのは、構造のタグ・SVG・部品の名前と、許可表の属性だけ。属性の値も検査する: `href` / `src` は相対(`//` と `\` で始まらない)か `http(s)` / `mailto` / `#`、
 * `style` は CSS のカスタムプロパティの宣言だけ、`id` / `name` は予約された名前(`app` や VitePress のもの・`window` などの DOM の名前)を除く。
 * 部品の式の属性(`:items` / `:cells`)は、生成器が登録簿に登録した値で、Vue と同じ復号で読み直した JSON を同じ直列化で書き直して一致するものだけ。
 * `on*`・`v-*`・`@*`・`srcdoc`・`pre`・`textarea`・フォーム部品は通らない。**アプリの語彙は 1 語も持たない**。
 */

import { serializeJsonAttr, type TrustedHtml } from './trusted-html.js';

/** 通すタグ(小文字の HTML と SVG)。フォーム部品・`pre`・`textarea` は載せない(必要な見本やプレビューは生成器が登録する)。 */
const HTML_TAGS: readonly string[] = `
  a b br caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2
  h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p section small span strong sub summary sup
  table tbody td template tfoot th thead tr ul wbr svg g path rect text tspan marker defs line circle polygon polyline
`.split(/\s+/).filter((name) => name !== '');

/** 通す部品のタグ(テーマが登録した部品。大文字始まり)。 */
const COMPONENT_TAGS: readonly string[] = ['Fold', 'Term', 'PanZoom', 'Mode', 'Grid', 'Steps'];

/** 通すタグの集合。 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([...HTML_TAGS, ...COMPONENT_TAGS]);

/** 通す属性の名前(`data-*` / `aria-*` / スロット `#名前` は別に通す)。 */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set(
  `
  class id title href src alt type value name style role width height rows cols min
  max step disabled required selected checked readonly readOnly maxLength colSpan rowSpan target rel for open placeholder
  viewBox d x y dx dy rx ry cx cy r x1 y1 x2 y2 points
  fill stroke stroke-width text-anchor marker-end marker-start markerWidth markerHeight refX refY orient transform xmlns kind hint count
  text label inert hidden
`.split(/\s+/).filter((name) => name !== ''),
);

/** 閉じタグの無い要素。 */
export const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'col', 'wbr']);

/** `<template>` の親にしてよい部品。 */
export const COMPONENT_NAMES: ReadonlySet<string> = new Set(COMPONENT_TAGS);

/** 式として評価される部品の属性。 */
const EXPRESSION_ATTRIBUTES: ReadonlySet<string> = new Set([':cells', ':items']);

/**
 * `id` / `name` / 見出しのアンカーに置けない名前(小文字で比べる): ページの土台の要素と VitePress が引く名前、
 * `window` や `document` の同名の属性を上書きする DOM の名前(DOM clobbering。`book.js` が `document` から引く名前は `book-client-script.test.ts` が全部ここにあることを見る)。
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set(
  `
  app root content main layout nav sidebar aside outline footer header skip-link local-nav hero
  window document location top parent self frames opener history navigator name length status event console alert fetch
  localstorage sessionstorage constructor prototype tostring valueof hasownproperty isprototypeof __proto__
  queryselector queryselectorall createelement addeventlistener documentelement
  `
    .split(/\s+/)
    .filter((name) => name !== ''),
);

/** 予約された名前か(`VP` で始まる VitePress の名前を含む)。 */
export function reservedName(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_NAMES.has(lower) || lower.startsWith('vp') || lower.startsWith('__') || lower.startsWith('vitepress');
}

/** タグの開き(`<` + 名前)。 */
export const TAG_START = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/;

/** 属性 1 つ(名前 = "値" / '値' / 値 / 名前だけ)。 */
export const ATTRIBUTE = /^[ \t]+([^\s"'<>/=]+)(?:[ \t]*=[ \t]*(?:"([^"\n]{0,20000})"|'([^'\n]{0,20000})'|([^\s"'=<>`]{1,20000})))?/;

/** 零幅の文字(U+200B)。文字そのもので挟む(文字参照にしない: コードの中でも字面に出ない)。 */
export const ZWSP = '​';

/**
 * 相対か安全なスキームの URL。
 *
 * 文字参照(`jav&#x61;script:` `&colon;` `&NewLine;` `&#9;` ほか)で検査をすり抜けさせないため、**`&` を含む値は通さない**(生成器が出す URL は経路で、`&` を持たない)。
 * そのうえで制御文字・空白・零幅の文字を除き、**`//` と `\` で始まるもの(スキーム相対・バックスラッシュ)は通さない**。許可表は
 * `https:` `http:` `mailto:` `#` 相対パス(`./` `../` `/` 1 本)・スキームを持たない文字列。
 */
export function safeUrl(value: string): boolean {
  if (value.includes('&')) return false;
  const compact = value.replace(/[\u0000- \u007F-\u009F​-‏\u2028\u2029⁠﻿]/g, '').toLowerCase();
  if (/^[\\/]{2}/.test(compact) || compact.includes('\\')) return false;
  return /^(?:https?:|mailto:|#|\.{1,2}\/|\/|[^:]*$)/.test(compact);
}

/** CSS のカスタムプロパティの宣言だけで書かれた style か(文字参照は通さない)。 */
export function safeStyle(value: string): boolean {
  return !value.includes('&') && /^(?:\s*--[a-z][a-z0-9-]*\s*:\s*[A-Za-z0-9 ,.()%_-]+;?)+\s*$/.test(value) && !/url\s*\(|expression|@import/i.test(value);
}

/**
 * 部品の式の属性の値を通してよいか。
 * 生成器が登録した値であり、**Vue と同じ復号**(ここで現れうる実体は `&amp;` と `&#39;` だけ。ほかの `&` は復号しない = 一致しない)で読み直した JSON を
 * 生成器と同じ直列化で書き直して、元の値とバイトが一致すること。
 */
function expressionValueAllowed(value: string, trusted: TrustedHtml): boolean {
  if (!trusted.jsonAttrs.has(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value.replace(/&(?:amp|#39);/g, (entity) => (entity === '&amp;' ? '&' : "'")));
    return Array.isArray(parsed) && serializeJsonAttr(parsed) === value;
  } catch {
    return false;
  }
}

/** 属性 1 つを通してよいか。 */
function attributeAllowed(tag: string, name: string, value: string | undefined, quote: string, trusted: TrustedHtml): boolean {
  // スロットの略記(`#名前`)は `<template>` の上だけ(`v-slot` は書けない)。
  if (name.startsWith('#')) return tag === 'template' && /^#[A-Za-z0-9_-]+$/.test(name) && value === undefined;
  if (EXPRESSION_ATTRIBUTES.has(name)) return value !== undefined && quote === "'" && expressionValueAllowed(value, trusted);
  if (/^(data|aria)-[A-Za-z0-9_-]+$/.test(name)) return true;
  if (!ALLOWED_ATTRIBUTES.has(name)) return false;
  if (value === undefined) return true;
  if (name === 'href' || name === 'src') return safeUrl(value);
  if (name === 'style') return safeStyle(value);
  if (name === 'id' || name === 'name') return /^[A-Za-z][A-Za-z0-9_:-]*$/.test(value) && !reservedName(value);
  return true;
}

/** 通したタグ: 名前・全体の長さと、式の属性の値の範囲(その範囲は割らずに写す)。 */
export interface AllowedTag {
  readonly name: string;
  readonly closing: boolean;
  /** 閉じる必要が無い(`/>` で終わる・空要素)。 */
  readonly selfClosed: boolean;
  readonly length: number;
  readonly expressionRanges: readonly (readonly [number, number])[];
  /** スロットの略記 `#名前` の名前(`<template #名前>` のとき)。 */
  readonly slot?: string;
}

/** 1 つのタグに置ける属性の数の上限(読む手間を抑える。実装が描く要素はこれより少ない)。 */
const MAX_ATTRIBUTES = 40;

/** 1 つのタグの長さの上限(部品の式の属性の JSON を含む)。 */
const MAX_TAG_LENGTH = 20_000;

/** 位置を指して読む正規表現(`lastIndex` から。残りの文字列を切り出さない)。 */
const TAG_START_AT = /<(\/?)([A-Za-z][A-Za-z0-9-]*)/y;
const ATTRIBUTE_AT = /[ \t]+([^\s"'<>/=]+)(?:[ \t]*=[ \t]*(?:"([^"\n]{0,20000})"|'([^'\n]{0,20000})'|([^\s"'=<>`]{1,20000})))?/y;
const CLOSE_END_AT = /[ \t]*>/y;
const OPEN_END_AT = /[ \t]*\/?>/y;

/**
 * 位置 `at` から始まるタグを読み、通してよいならその長さと式の属性の値の範囲を返す(通せないなら null)。
 *
 * **タグの中に改行を許さない**(空白は空白とタブだけ。引用符の値も 1 行)。改行を含むタグを 1 つのタグとして読み飛ばすと、行の状態がずれ、次の行頭の `>` を
 * Markdown が引用と読んで対が割れる(Vue のコンパイルが落ちる)。
 *
 * 同じ名前の属性が 2 回現れるタグ(大文字小文字を区別しない: `class` と `CLASS`)は通さない(Vue のコンパイルが「重複した属性」で落ちる)。
 *
 * @param text 全体
 * @param at `<` の位置
 * @param trusted 登録簿
 */
export function allowedTag(text: string, at: number, trusted: TrustedHtml): AllowedTag | null {
  TAG_START_AT.lastIndex = at;
  const start = TAG_START_AT.exec(text);
  if (start === null) return null;
  const closing = start[1] === '/';
  const name = start[2] ?? '';
  if (!ALLOWED_TAGS.has(name)) return null;
  let cursor = at + start[0].length;
  if (closing) {
    CLOSE_END_AT.lastIndex = cursor;
    const end = CLOSE_END_AT.exec(text);
    return end === null ? null : { name, closing: true, selfClosed: false, length: cursor + end[0].length - at, expressionRanges: [] };
  }
  const expressionRanges: [number, number][] = [];
  const seen = new Set<string>();
  let slot: string | undefined;
  for (;;) {
    ATTRIBUTE_AT.lastIndex = cursor;
    const attribute = ATTRIBUTE_AT.exec(text);
    if (attribute === null) break;
    const attributeName = attribute[1] ?? '';
    const value = attribute[2] ?? attribute[3] ?? attribute[4];
    const quote = attribute[2] !== undefined ? '"' : attribute[3] !== undefined ? "'" : '';
    if (seen.size >= MAX_ATTRIBUTES || seen.has(attributeName.toLowerCase())) return null;
    seen.add(attributeName.toLowerCase());
    if (!attributeAllowed(name, attributeName, value, quote, trusted)) return null;
    if (attributeName.startsWith('#')) slot = attributeName.slice(1);
    if (EXPRESSION_ATTRIBUTES.has(attributeName) && value !== undefined) {
      const valueStart = cursor - at + attribute[0].length - value.length - 1;
      expressionRanges.push([valueStart, valueStart + value.length]);
    }
    cursor += attribute[0].length;
    if (cursor - at > MAX_TAG_LENGTH) return null;
  }
  OPEN_END_AT.lastIndex = cursor;
  const end = OPEN_END_AT.exec(text);
  if (end === null || cursor + end[0].length - at > MAX_TAG_LENGTH) return null;
  const tag = { name, closing: false, selfClosed: end[0].endsWith('/>') || VOID_TAGS.has(name), length: cursor + end[0].length - at, expressionRanges };
  return slot === undefined ? tag : { ...tag, slot };
}
