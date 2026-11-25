/**
 * 本の 1 ページ(HTML の文書)が出力の口の約束どおりかの**閉じた**検査(点検 13 回目 C13-1)。
 *
 * 見るのは出力そのもの(口を通ったかどうかは問わない)。文書の頭はちょうどの字面、タグと属性は表の中だけ、`<script>` は `book.js` の 1 本だけ、URL はスキームの表の中だけ。
 * 表の外は全部破れで、知らない形を通さない。生の文字列で書いたページも、ここで赤になる。
 */

import { BOOK_TAGS } from '../../lib/generate/render/book/html/markup.js';
import { reservedName } from '../../lib/kernel/html-allow-list.js';
import { htmlTokens, type HtmlAttribute } from './html-tokens.js';

/** ページの CSP のちょうどの値(実装の定数を読まず、ここに字面で固定する)。 */
export const BOOK_CSP_LITERAL = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

/** 文書の頭のちょうどの字面(`<title>` の前まで)。 */
const HEAD_LITERAL =
  '<!doctype html>\n<!-- このファイルは全体が生成物である(npm run generate が全置換する)。手で編集しない。 -->\n<html lang="ja" class="bf-html">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<meta http-equiv="Content-Security-Policy" content="${BOOK_CSP_LITERAL}"><title>`;

/** 文書の枠のタグ。 */
const FRAME_TAGS: ReadonlySet<string> = new Set(['html', 'head', 'meta', 'title', 'link', 'script', 'body']);

/** プレビューの断片だけが足すタグ(`preview-check.ts` の表の、`BOOK_TAGS` の外の分)。 */
const PREVIEW_TAGS: ReadonlySet<string> = new Set(['dialog', 'form', 'input', 'label', 'option', 'select', 'textarea']);

/** 通す属性(本の口と、プレビューの断片。`preview-check.ts` の表)。`on*`・`style`・`srcdoc`・`formaction` は無い。 */
const ATTRIBUTES: ReadonlySet<string> = new Set(
  `class id title lang role href src alt type open hidden inert colspan rowspan scope width height loading tabindex viewbox d x y dx dy rx ry cx cy r x1 y1 x2 y2 points
  text-anchor dominant-baseline marker-end markerwidth markerheight refx refy orient xmlns value name rows cols min max step disabled required selected checked readonly maxlength
  target rel for placeholder multiple autocomplete pattern accept method action fill stroke stroke-width transform`.split(/\s+/),
);

/** 閉じタグの無い要素。 */
const VOID: ReadonlySet<string> = new Set(['br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'wbr']);

/** 置いてよい URL のスキーム(スキームの無い相対と `#` は別に通す)。 */
const SCHEMES: ReadonlySet<string> = new Set(['https:', 'mailto:']);

/** ページの資材の置き場(本の根から)。 */
const STYLESHEETS: ReadonlySet<string> = new Set(['assets/tokens.css', 'assets/ui.css', 'assets/face.css']);

/** `html` / `head` / `body` の許す属性(文書に 1 本ずつ。本文の中の 2 本目はブラウザが属性を既存の要素へ足す。14 回目 C14-6)。 */
const FRAME_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = { html: ['class', 'lang'], head: [], body: [] };

/** URL が表の中か(制御文字・空白を除いて読む)。戻せなかった名前つきの文字参照が残れば読めないので赤。 */
function urlAllowed(value: string): boolean {
  if (/&[A-Za-z][A-Za-z0-9]*;/.test(value)) return false;
  const compact = value.replace(/[\u0000- \u007F-\u009F]/g, '').toLowerCase();
  if (compact.startsWith('//') || compact.includes('\\')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*:)/.exec(compact)?.[1];
  return scheme === undefined || SCHEMES.has(scheme);
}

/** このページから本の根への前置き。 */
function prefixOf(file: string, bookRoot: string): string {
  const depth = file.slice(bookRoot.length + 1).split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** 属性 1 つの破れ。 */
function attributeProblem(tag: string, attribute: HtmlAttribute): string | null {
  const { name, value } = attribute;
  if (!ATTRIBUTES.has(name) && !/^(?:data-[a-z0-9-]+|aria-[a-z-]+)$/.test(name)) return `表に無い属性 ${name}(${tag})`;
  if ((name === 'href' || name === 'src' || name === 'action') && !urlAllowed(value)) return `危険な ${name}(${tag}): ${value.slice(0, 60)}`;
  if (name === 'action' && !/^\/(?![/\\])/.test(value)) return `同じオリジンのパスでない action: ${value.slice(0, 60)}`;
  if (name === 'name' && reservedName(value)) return `予約された name(${tag}): ${value}`;
  return null;
}

/** 文書の枠のタグの破れ。 */
function frameProblem(tag: string, attributes: readonly HtmlAttribute[], prefix: string, inHead: boolean): string | null {
  const value = (name: string): string | undefined => attributes.find((attribute) => attribute.name === name)?.value;
  const names = attributes.map((attribute) => attribute.name).sort().join(' ');
  const allowed = FRAME_ATTRIBUTES[tag];
  if (allowed !== undefined && names !== allowed.join(' ')) return `表に無い ${tag} の属性: ${names}`;
  if (tag === 'script') return names === 'defer src' && value('src') === `${prefix}assets/book.js` && inHead ? null : `表に無い script: ${names} ${value('src') ?? ''}`;
  if (tag === 'link') return names === 'href rel' && value('rel') === 'stylesheet' && [...STYLESHEETS].some((path) => value('href') === `${prefix}${path}`) && inHead ? null : `表に無い link: ${value('href') ?? ''}`;
  return null;
}

/**
 * ページ 1 枚の破れ。
 *
 * @param html ページ
 * @param file 出力のファイルの位置(リポジトリルートから)
 * @param bookRoot 本の根
 * @returns 破れ(空なら約束どおり)
 */
export function bookPageProblems(html: string, file: string, bookRoot: string): readonly string[] {
  const problems: string[] = [];
  if (!html.startsWith(HEAD_LITERAL)) problems.push('文書の頭が約束の字面でない(CSP・meta・出力の口を通ったページの形)');
  if (!html.endsWith('</body>\n</html>\n')) problems.push('文書の終わりが約束の字面でない');
  const prefix = prefixOf(file, bookRoot);
  const stack: string[] = [];
  const frames = new Map<string, number>();
  let scripts = 0;
  let metas = 0;
  let comments = 0;
  let doctypes = 0;
  for (const token of htmlTokens(html)) {
    if (token.type === 'doctype') doctypes += 1;
    if (token.type === 'comment') comments += 1;
    if (token.type === 'end') {
      if (token.attributes.length > 0) problems.push(`閉じタグ ${token.name} に属性がある`);
      const top = stack.pop();
      if (top !== token.name) problems.push(`閉じタグ ${token.name} が開き ${top ?? '(無し)'} と対にならない`);
    }
    if (token.type !== 'start') continue;
    const { name, attributes, selfClosing } = token;
    const inHead = stack.includes('head');
    if (!BOOK_TAGS.has(name) && !FRAME_TAGS.has(name) && !PREVIEW_TAGS.has(name)) problems.push(`表に無いタグ ${name}`);
    if (name === 'script') scripts += 1;
    if (name === 'meta') metas += 1;
    if (Object.hasOwn(FRAME_ATTRIBUTES, name)) frames.set(name, (frames.get(name) ?? 0) + 1);
    if (FRAME_TAGS.has(name) && name !== 'title') {
      const frame = frameProblem(name, attributes, prefix, inHead);
      if (frame !== null) problems.push(frame);
      if (name === 'meta' && !inHead) problems.push('本文の meta');
    } else {
      for (const attribute of attributes) {
        const found = attributeProblem(name, attribute);
        if (found !== null) problems.push(found);
      }
    }
    const seen = new Set(attributes.map((attribute) => attribute.name));
    if (seen.size !== attributes.length) problems.push(`同じ名前の属性が 2 回ある(${name})`);
    if (!VOID.has(name) && !(selfClosing && stack.includes('svg'))) stack.push(name);
  }
  for (const name of Object.keys(FRAME_ATTRIBUTES)) {
    if (frames.get(name) !== 1) problems.push(`${name} は 1 本だけ(${frames.get(name) ?? 0} 本)`);
  }
  if (scripts !== 1) problems.push(`script は book.js の 1 本だけ(${scripts} 本)`);
  if (metas !== 3) problems.push(`meta は 3 本だけ(${metas} 本)`);
  if (comments !== 1 || doctypes !== 1) problems.push(`注釈 ${comments} 件・doctype ${doctypes} 件(各 1 件だけ)`);
  if (stack.length > 0) problems.push(`閉じていない要素: ${stack.join(' ')}`);
  return [...new Set(problems)];
}
