/**
 * ハンドブックの HTML を組み立てる**唯一の出力の口**。
 *
 * 本は生成器が HTML を直接書き出す。出力にテンプレートとして読まれる段(Markdown・Vue)は無いので、守るのは HTML の 3 つの文脈だけである:
 *
 * | 文脈 | 口 | 守り方 |
 * |---|---|---|
 * | 本文 | `text` / `el` の子 | `& < > " '` を実体参照にする(文字列の子は自動でこれを通る) |
 * | 属性の値 | `el` の属性 | 常に二重引用符で囲み、同じ実体参照にする。属性の名前は型の許可表だけ(`on*`・`style`・`srcdoc` は書けない) |
 * | URL | `href` / `src` | `url` で作った `SafeUrl` だけが置ける。スキームの許可表(相対・`#`・`https:`・`mailto:`)の外は作れない |
 *
 * **`Html` は、この口を通った文字列だけが持つブランド型**である。生の HTML を通す道は次だけで、どれも仕様の文字列を受け取れない:
 *
 * - `markup` … 生成器のコードに書いた**定数**(テンプレートリテラルの置換を持てない。`markup\`<hr>\`` の形だけ)
 * - `previewFragment` … 実装の CSS で描く断片(画面の SSR プレビューと、デザインの章の部品の見本)。**この口が自分で**画面プレビューの許可表(`preview-check.ts`。`on*`・`script`・`style` 要素・
 *   危険な URL は無い)に通し、通らなければ置かない(章の呼び手が `preview-refusal.ts` で生成を止める)
 * - タグの許可表(`TagName`)は構造のタグと SVG だけで、`script` / `style` / `iframe` / `object` / `form` 系は無い(ページの枠の `<script src>` と
 *   `<link>` は頭の専用の `deferredScript` / `stylesheet` が書き、本文の子にはならない)
 *
 * CSS と script の文脈には口を作らない(値を埋める必要が出たら、`data-*` 属性に置いて静的な script が読む)。
 * 純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 *
 * `Html` を作れる道(本文・属性・URL・定数・画面の断片)は、作った文字列の記録(`madeStrings`)と `mark` を共有する。全部の道がこの 1 枚にあることが「ほかに `Html` を作る道は無い」の確かめ方になるので、
 * `mark` を export して割らない。
 */

import { flatFragment, previewProblems } from '../../../../kernel/preview-check.js';

declare const HTML_BRAND: unique symbol;
declare const URL_BRAND: unique symbol;

/** この口を通った HTML の断片。 */
export type Html = string & { readonly [HTML_BRAND]: true };

/** スキームの許可表を通った URL(属性に置く前の、実体参照にする前の値)。 */
export type SafeUrl = string & { readonly [URL_BRAND]: true };

/** 構造のタグ(本文)。 */
const BODY_TAGS = [
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'wbr',
] as const;

/** SVG のタグ(図)。`foreignObject`・`animate` 系・`set`・`use`・`image`・`script`・`style` は無い。 */
const SVG_TAGS = ['svg', 'g', 'path', 'rect', 'text', 'tspan', 'marker', 'defs', 'line', 'circle', 'ellipse', 'polygon', 'polyline', 'title', 'desc'] as const;

/** 書けるタグの全数。 */
export type TagName = (typeof BODY_TAGS)[number] | (typeof SVG_TAGS)[number];

/** 書けるタグの実行時の表(型をすり抜けた値の最後の止め。属性の `ATTR_NAMES` と同じ役目。点検 13 回目 C13-9)。 */
export const BOOK_TAGS: ReadonlySet<string> = new Set<string>([...BODY_TAGS, ...SVG_TAGS]);

/** 中身を持たないタグ。 */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'col', 'hr', 'img', 'wbr']);

/** 属性の値(`true` は値なしの属性、`false` / `null` / `undefined` は書かない)。 */
type AttrValue = string | number | boolean | null | undefined;

/**
 * 書ける属性(型の許可表)。`on*`・`style`・`srcdoc`・`formaction`・`xlink:href`・`action` は**型に無い**ので書けない。
 * `href` / `src` は `SafeUrl` だけ。`data-*` / `aria-*` は値を実体参照にして通す。
 */
export interface Attrs {
  readonly class?: string | readonly (string | false | null | undefined)[];
  readonly id?: string;
  readonly title?: string;
  readonly lang?: string;
  readonly role?: string;
  readonly href?: SafeUrl;
  readonly src?: SafeUrl;
  readonly alt?: string;
  readonly type?: 'button';
  readonly open?: boolean;
  readonly hidden?: boolean;
  readonly inert?: boolean;
  readonly colspan?: number;
  readonly rowspan?: number;
  readonly scope?: 'col' | 'row';
  readonly width?: number | string;
  readonly height?: number | string;
  readonly loading?: 'lazy';
  readonly tabindex?: number;
  // SVG の幾何(数と、数・空白・記号だけの文字列)。
  readonly viewBox?: string;
  readonly d?: string;
  readonly x?: number;
  readonly y?: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly cx?: number;
  readonly cy?: number;
  readonly r?: number;
  readonly x1?: number;
  readonly y1?: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly points?: string;
  readonly 'text-anchor'?: 'start' | 'middle' | 'end';
  readonly 'dominant-baseline'?: 'middle' | 'central' | 'hanging';
  readonly 'marker-end'?: `url(#${string})`;
  readonly markerWidth?: number;
  readonly markerHeight?: number;
  readonly refX?: number;
  readonly refY?: number;
  readonly orient?: 'auto';
  readonly xmlns?: 'http://www.w3.org/2000/svg';
  readonly [data: `data-${string}`]: AttrValue;
  readonly [aria: `aria-${string}`]: AttrValue;
}

/** 子(配列は平らにする。`null` / `undefined` / `false` は何も出さない。文字列と数は本文として逃がす)。 */
export type Child = Html | string | number | null | undefined | false | readonly Child[];

/** 本文・属性の値の実体参照。 */
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** 文字列を本文の HTML にする。 */
export function text(value: string | number): Html {
  return mark(escape(String(value)));
}

/**
 * 生成器のコードに書いた定数の HTML(置換を持てないテンプレートリテラル)。仕様の文字列は型の上で渡せない。
 *
 * @example markup`<hr class="bf-rule">`
 */
export function markup(strings: TemplateStringsArray, ...none: readonly never[]): Html {
  if (none.length > 0 || strings.length !== 1) throw new Error('markup は置換を持たない定数だけを受け取る');
  return mark(strings[0] ?? '');
}

/**
 * 実装が描いた画面の断片(SSR プレビュー)を置く。画面プレビューの許可表(`preview-check.ts`)を通らなければ null(呼び手が生成を止める)。
 *
 * 改行は実体参照にしてから検査する(検査する形と置く形を揃える)。
 *
 * @param html 実装の描画結果
 */
export function previewFragment(html: string): Html | null {
  const flat = flatFragment(html);
  return previewProblems(flat).length === 0 ? mark(flat) : null;
}

/** 許可するスキーム(`#` と相対はスキームを持たない)。 */
const URL_SCHEMES: ReadonlySet<string> = new Set(['https:', 'mailto:']);

/**
 * URL をスキームの許可表に通す。許可表の外は例外にする(生成器の不具合か、仕様に危険な値がある = 黙って捨てない)。
 *
 * 判定は、制御文字・空白を除いて小文字にした形で行う(`java\tscript:` などの書き換えで抜けない)。スキーム相対(`//`)とバックスラッシュは通さない。
 * `&` は通す(属性に置くときに実体参照にするので、文字参照で別の文字に化けることは無い)。
 */
export function url(value: string): SafeUrl {
  const compact = value.replace(/[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '').toLowerCase();
  if (compact.startsWith('//') || compact.includes('\\')) throw new Error(`URL の形が許可表の外: ${value.slice(0, 80)}`);
  const scheme = /^([a-z][a-z0-9+.-]*:)/.exec(compact)?.[1];
  if (scheme !== undefined && !URL_SCHEMES.has(scheme)) throw new Error(`URL のスキームが許可表の外: ${value.slice(0, 80)}`);
  return value as SafeUrl;
}

/** 書ける属性の名前(`Attrs` と同じ並び。型をすり抜けた値の最後の止め)。`data-*` / `aria-*` は形で通す。 */
const ATTR_NAMES: ReadonlySet<string> = new Set(
  `class id title lang role href src alt type open hidden inert colspan rowspan scope width height loading tabindex viewBox d x y dx dy rx ry cx cy r
  x1 y1 x2 y2 points text-anchor dominant-baseline marker-end markerWidth markerHeight refX refY orient xmlns`.split(/\s+/),
);

/** 属性の名前を通してよいか。 */
function attributeNameAllowed(name: string): boolean {
  return ATTR_NAMES.has(name) || /^(?:data-[a-z0-9-]+|aria-[a-z-]+)$/.test(name);
}

/** 属性の並びを書く。 */
function attributes(attrs: Attrs | null): string {
  if (attrs === null) return '';
  let out = '';
  for (const [name, raw] of Object.entries(attrs) as [string, unknown][]) {
    if (!attributeNameAllowed(name)) throw new Error(`書けない属性: ${name}`);
    const value = name === 'class' && Array.isArray(raw) ? raw.filter((part): part is string => typeof part === 'string' && part !== '').join(' ') : raw;
    if (value === undefined || value === null || value === false || value === '') continue;
    if (value === true) {
      out += ` ${name}`;
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`属性 ${name} の値の型が許可表の外`);
    if ((name === 'href' || name === 'src') && typeof value === 'string') url(value);
    out += ` ${name}="${escape(String(value))}"`;
  }
  return out;
}

/** 子を平らにして HTML にする。 */
function children(items: readonly Child[]): string {
  let out = '';
  for (const item of items) {
    if (item === null || item === undefined || item === false) continue;
    if (Array.isArray(item)) out += children(item as readonly Child[]);
    else if (typeof item === 'number') out += String(item);
    else out += isHtml(item as string) ? (item as string) : escape(item as string);
  }
  return out;
}

/**
 * `Html` の印は型の上にしか無いので、実行時は「この口が作った文字列」を記録して見分ける。
 * 文字列を `as Html` で偽った値は、ここで本文として逃がされる(型の抜け道を実行時にも塞ぐ)。
 * 仕様の文字列が、たまたまこの口が作った断片と同じ並びなら断片として通る。通るのはこの口が組んだ安全な HTML だけで(頭の `<script>` / `<link>` は記録しない)、残るのは字面の二重の逃がしの差だけである。
 */
const madeStrings = new Set<string>();

/** この口が作った文字列か。 */
function isHtml(value: string): boolean {
  return madeStrings.has(value);
}

/** 作った文字列を記録して返す。 */
function mark(value: string): Html {
  madeStrings.add(value);
  return value as Html;
}

/**
 * 要素を 1 つ作る。
 *
 * @param tag 許可表のタグ
 * @param attrs 属性(型の許可表)
 * @param kids 子(文字列は本文として逃がす)
 */
export function el(tag: TagName, attrs: Attrs | null, ...kids: readonly Child[]): Html {
  if (!BOOK_TAGS.has(tag)) throw new Error(`書けないタグ: ${String(tag)}`);
  const open = `<${tag}${attributes(attrs)}>`;
  if (VOID_TAGS.has(tag)) {
    if (kids.length > 0) throw new Error(`${tag} は子を持てない`);
    return mark(open);
  }
  return mark(`${open}${children(kids)}</${tag}>`);
}

/** 断片を並べる(区切りも `Html`)。 */
export function join(parts: readonly Child[], separator?: Html): Html {
  const rendered = parts.map((part) => children([part])).filter((part) => part !== '');
  return mark(rendered.join(separator ?? ''));
}

/**
 * 本のページの CSP(インラインの script・外の資材・埋め込み・フォームの送信先を持たない)。ページの `<meta>` と `book:open` の応答の見出しが同じ値を置く。
 * mermaid などを足すときもここを広げずに `self` の資材で足す。
 */
export const BOOK_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

/** 本のページの CSP の `<meta>`(値は定数。単引用符は CSP の文法なので、実体参照にしない)。 */
export function cspMeta(): Html {
  return mark(`<meta http-equiv="Content-Security-Policy" content="${BOOK_CSP}">`);
}

/**
 * 頭のスタイルシートの読み込み(属性は固定。値は URL の口を通ったものだけ)。**頭の専用**で、本文の子にはならない(`madeStrings` に記録しない)。
 *
 * @param href 同じ本の資材への URL
 */
export function stylesheet(href: SafeUrl): string {
  return `<link rel="stylesheet"${attributes({ href })}>`;
}

/**
 * 頭の script の読み込み(`defer` 固定。インラインの script は作れない)。**頭の専用**で、`madeStrings` に記録しない
 * (記録すると、同じ字面の仕様の文字列が断片として本文に素通りし、`book.js` がもう 1 回走る。点検 13 回目 C13-9)。
 *
 * @param src 同じ本の資材への URL
 */
export function deferredScript(src: SafeUrl): string {
  return `<script${attributes({ src })} defer></script>`;
}

/** 何も出さない断片。 */
export const EMPTY: Html = mark('');
