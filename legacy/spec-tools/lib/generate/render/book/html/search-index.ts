/**
 * 本の全文検索の索引(`assets/search.json`)を、生成した本文から作る。
 *
 * ページごとに、本文を見出し(`id`)の位置で切り、節 1 つにつき 1 件 `{ href, page, heading, text }` を作る(見出しより前の部分はページの頭として 1 件)。
 * 字は本文の HTML からタグを除き、出力の口(`markup.ts`)が作る実体参照(`&#38;` などの数値参照と `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`)を戻し、空白を 1 つにたたんで
 * 先頭から `TEXT_LIMIT` 字に切る。`<svg>` の中身(図の字)は読まない。
 * **検証の結果に依る部分(印 `data-dep="verify"` の付いた要素)は、中身ごと索引に入れない。** ハンドブックだけを出す入口(`npm run book`)は検証を回さないので、
 * その字を入れると全部入りの `generate` の索引と食い違い、入口の出力を全部入りと比べる検査(`book --check`)が通らなくなる。
 *
 * - 純粋関数だけ。順序は決まっている(渡されたページの順、ページの中は節の順)ので、同じ入力から同じ JSON ができる。
 * - 索引は JSON だけで、script には入れない(`fetch` で読む。CSP の `connect-src 'self'`)。
 * - **書き方の例(`examples.html`)は別の生成器(`examples-generator.ts`)が書くので、この索引には入れない。**
 * - **アプリの語彙は 1 語も持たない。**
 */

import type { Html } from './markup.js';
import type { PageHeading } from './page.js';

/** 索引の 1 件。 */
export interface SearchEntry {
  /** 本の根から見たページの位置と見出しの `id`(ページの頭は `id` なし)。 */
  readonly href: string;
  readonly page: string;
  readonly heading: string;
  readonly text: string;
}

/** 索引にするページ 1 枚の材料。 */
export interface SearchSource {
  readonly file: string;
  readonly title: string;
  readonly body: Html;
  readonly headings: readonly PageHeading[];
}

/** `text` の長さの上限(コードポイント)。 */
export const TEXT_LIMIT = 400;

/** 改行として読むタグ(語の切れ目になる)。それ以外のタグは何も挟まず除く。 */
const BREAKING_TAG =
  /<\/?(?:p|div|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|br|hr|section|article|aside|header|footer|nav|main|dl|dt|dd|summary|details|pre|blockquote|figure|figcaption)\b[^>]*>/g;

/** 名前つきの実体参照(出力の口が作るもの)。 */
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** 実体参照を戻す(1 回だけ。`&amp;lt;` は `&lt;` になる)。 */
function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-z]+));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** 検証の結果に依る要素の印(`face-parts.ts` の `verified`)。 */
const VERIFY_MARK = ' data-dep="verify"';

/**
 * 印の付いた要素を中身ごと除く。生成器が組んだ HTML なので、同じ名前のタグの開きと閉じを数えれば要素の終わりが決まる(`book-verification-cut.ts` と同じ数え方)。
 * 読めない印は残す(索引は黙って欠けるより、字が多めに残るほうがよい)。
 */
function withoutVerified(html: string): string {
  let out = '';
  let index = 0;
  for (;;) {
    const mark = html.indexOf(VERIFY_MARK, index);
    if (mark === -1) break;
    const start = html.lastIndexOf('<', mark);
    const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1];
    if (tag === undefined) break;
    const tokens = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    tokens.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let token = tokens.exec(html); token !== null; token = tokens.exec(html)) {
      depth += token[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = token.index + token[0].length;
        break;
      }
    }
    if (end === -1) break;
    out += `${html.slice(index, start)} `;
    index = end;
  }
  return out + html.slice(index);
}

/**
 * HTML の断片を読む字にする(タグ除去・実体参照の復元・空白のたたみ)。長さの上限はここでは切らない。
 *
 * @param html 本文の HTML の断片
 */
export function plainText(html: string): string {
  const withoutSvg = withoutVerified(html).replace(/<svg\b[\s\S]*?<\/svg>/g, ' ');
  const spaced = withoutSvg.replace(BREAKING_TAG, ' ').replace(/<[^>]*>/g, '');
  return decodeEntities(spaced).replace(/\s+/g, ' ').trim();
}

/** 先頭から `limit` コードポイントに切る。 */
function truncate(value: string, limit: number): string {
  const points = Array.from(value);
  return points.length <= limit ? value : points.slice(0, limit).join('');
}

/** 出力の口が `id` 属性に置く形(`& < > " '` を数値参照にする)。 */
function escapedAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * ページ 1 枚を節に切って索引の件にする。
 *
 * 見出しの位置は本文の先頭から順に `id="..."` を探して決める(見つからない見出しは節を作らない)。
 *
 * @param source ページの材料
 */
export function searchEntriesOf(source: SearchSource): SearchEntry[] {
  const body: string = source.body;
  const starts: { readonly heading: PageHeading; readonly at: number }[] = [];
  let cursor = 0;
  for (const heading of source.headings) {
    const mark = body.indexOf(`id="${escapedAttribute(heading.id)}"`, cursor);
    if (mark < 0) continue;
    const at = body.lastIndexOf('<', mark);
    if (at < cursor) continue;
    starts.push({ heading, at });
    cursor = mark;
  }
  const entry = (href: string, heading: string, from: number, to: number): SearchEntry => {
    // 節の字は見出しの要素から始まるので、先頭の見出しの字は `heading` と重なる。落として本文だけにする。
    const plain = plainText(body.slice(from, to));
    const own = plain.startsWith(heading) ? plain.slice(heading.length).trim() : plain;
    return { href, page: source.title, heading, text: truncate(own, TEXT_LIMIT) };
  };
  const first = starts[0]?.at ?? body.length;
  const entries: SearchEntry[] = [entry(source.file, source.title, 0, first)];
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.at ?? body.length;
    entries.push(entry(`${source.file}#${start.heading.id}`, plainText(start.heading.title), start.at, end));
  });
  return entries;
}

/**
 * 索引の JSON(1 件 1 行。差分が読める形)。
 *
 * @param sources ページの材料(出力した順)
 */
export function searchIndexJson(sources: readonly SearchSource[]): string {
  const lines = sources.flatMap((source) => searchEntriesOf(source)).map((item) => JSON.stringify(item));
  return `[\n${lines.join(',\n')}\n]\n`;
}

/**
 * 書き出した索引から、指定のページ(本の根から見たファイル名)の件を落とす(ハンドブックだけを出す入口が、書かない章の件を残さないため)。
 * 読めない JSON はそのまま返す(throw しない)。
 *
 * @param json `searchIndexJson` の出力
 * @param pages 落とすページ(例: `jobs.html`)
 */
export function searchIndexWithout(json: string, pages: ReadonlySet<string>): string {
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(items)) return json;
  const kept = items.filter((item: unknown) => {
    const href = (item as { readonly href?: unknown } | null)?.href;
    return typeof href !== 'string' || !pages.has(href.split('#')[0] ?? href);
  });
  return `[\n${kept.map((item) => JSON.stringify(item)).join(',\n')}\n]\n`;
}
