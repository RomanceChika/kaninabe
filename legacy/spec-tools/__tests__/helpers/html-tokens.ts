/**
 * テストが本の HTML を読むための字句解析(ブラウザの解析器の字句の段の写し。WHATWG の tokenization の、本の検査に要る範囲)。
 *
 * 依存を足さない: `spec-tools` の依存に HTML の解析器は無く(`jsdom` / `parse5` は入っていない)、Chromium は通常のテストの段では重い。
 * 文字列の検索でなくこの字句解析を通すので、属性の値の中の `>`・引用符の無い値・`/` の区切り・文字参照の属性は、ブラウザと同じ位置で切れる。
 */

/** 属性 1 つ。 */
export interface HtmlAttribute {
  readonly name: string;
  /** 文字参照を戻した値。 */
  readonly value: string;
}

/** 字句 1 つ。 */
export type HtmlToken =
  | { readonly type: 'doctype' | 'comment'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'end'; readonly name: string; readonly attributes: readonly HtmlAttribute[] }
  | { readonly type: 'start'; readonly name: string; readonly attributes: readonly HtmlAttribute[]; readonly selfClosing: boolean };

/** 中身を文字として読む要素(閉じタグまでタグを読まない)。 */
const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

/** 名前つきの文字参照(本の検査に要るもの。ほかの名前は戻さない。**戻らない名前が URL に残れば `book-page-check.ts` が赤にする**。14 回目 C14-6)。 */
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ' };

/** 文字参照を戻す。 */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));?/g, (whole, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return NAMED[(name ?? '').toLowerCase()] ?? whole;
  });
}

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';

/** 開きタグの属性を読む。 */
function readAttributes(html: string, from: number): { readonly attributes: HtmlAttribute[]; readonly selfClosing: boolean; readonly end: number } {
  const attributes: HtmlAttribute[] = [];
  let at = from;
  for (;;) {
    while (isSpace(html[at]) || (html[at] === '/' && html[at + 1] !== '>')) at += 1;
    if (at >= html.length) return { attributes, selfClosing: false, end: at };
    if (html[at] === '>') return { attributes, selfClosing: false, end: at + 1 };
    if (html[at] === '/') return { attributes, selfClosing: true, end: at + 2 };
    const nameStart = at;
    at += 1;
    while (at < html.length && !isSpace(html[at]) && html[at] !== '/' && html[at] !== '>' && html[at] !== '=') at += 1;
    const name = html.slice(nameStart, at).toLowerCase();
    while (isSpace(html[at])) at += 1;
    if (html[at] !== '=') {
      attributes.push({ name, value: '' });
      continue;
    }
    at += 1;
    while (isSpace(html[at])) at += 1;
    const quote = html[at];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, at + 1);
      const stop = close === -1 ? html.length : close;
      attributes.push({ name, value: decodeEntities(html.slice(at + 1, stop)) });
      at = stop + 1;
    } else {
      const valueStart = at;
      while (at < html.length && !isSpace(html[at]) && html[at] !== '>') at += 1;
      attributes.push({ name, value: decodeEntities(html.slice(valueStart, at)) });
    }
  }
}

/**
 * HTML を字句に割る。
 *
 * @param html 文書か断片
 * @returns 字句の並び
 */
export function htmlTokens(html: string): readonly HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let at = 0;
  let svgDepth = 0;
  const pushText = (text: string): void => {
    if (text !== '') tokens.push({ type: 'text', text });
  };
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open === -1) {
      pushText(html.slice(at));
      break;
    }
    const next = html[open + 1] ?? '';
    if (html.startsWith('<!--', open)) {
      pushText(html.slice(at, open));
      const close = html.indexOf('-->', open + 4);
      const stop = close === -1 ? html.length : close;
      tokens.push({ type: 'comment', text: html.slice(open + 4, stop) });
      at = stop + 3;
    } else if (next === '!' || next === '?') {
      pushText(html.slice(at, open));
      const close = html.indexOf('>', open);
      const stop = close === -1 ? html.length : close;
      const body = html.slice(open + 2, stop);
      tokens.push({ type: /^doctype/i.test(body) ? 'doctype' : 'comment', text: body });
      at = stop + 1;
    } else if (next === '/' && /[A-Za-z]/.test(html[open + 2] ?? '')) {
      pushText(html.slice(at, open));
      let cursor = open + 2;
      while (cursor < html.length && !isSpace(html[cursor]) && html[cursor] !== '/' && html[cursor] !== '>') cursor += 1;
      const name = html.slice(open + 2, cursor).toLowerCase();
      if (name === 'svg') svgDepth = Math.max(0, svgDepth - 1);
      // ブラウザは閉じタグにも属性を読む(引用符の中の `>` で切らない。点検 14 回目 C14-6)。
      const { attributes, end } = readAttributes(html, cursor);
      tokens.push({ type: 'end', name, attributes });
      at = end;
    } else if (/[A-Za-z]/.test(next)) {
      pushText(html.slice(at, open));
      let cursor = open + 1;
      while (cursor < html.length && !isSpace(html[cursor]) && html[cursor] !== '/' && html[cursor] !== '>') cursor += 1;
      const name = html.slice(open + 1, cursor).toLowerCase();
      const { attributes, selfClosing, end } = readAttributes(html, cursor);
      tokens.push({ type: 'start', name, attributes, selfClosing });
      at = end;
      if (name === 'svg' && !selfClosing) svgDepth += 1;
      if (RAW_TEXT.has(name) && svgDepth === 0) {
        const closing = new RegExp(`</${name}(?=[\\s/>])`, 'i').exec(html.slice(at));
        const stop = closing === null ? html.length : at + closing.index;
        pushText(html.slice(at, stop));
        at = stop;
        if (closing === null) break;
      }
    } else {
      pushText(html.slice(at, open + 1));
      at = open + 1;
    }
  }
  return tokens;
}
