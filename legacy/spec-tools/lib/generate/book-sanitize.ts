/**
 * 生成する Markdown(VitePress が描く `.md`)への**注入の無害化**(書き込みの出口で全ての `.md` の生成部分に掛ける純粋関数)。**本は HTML で、`.md` を 1 本も出さない**ので、本の守りはここでなく出力の口(`render/book/html/markup.ts`)である。
 *
 * VitePress は Markdown を Vue のテンプレートにコンパイルする。仕様の文字列がそのまま入ると、生の HTML(`<script>` は SFC の `<script>` として巻き上げられる)・
 * Vue の式(`{{ … }}` は描画のたびに評価され、サーバ側の描画では**ビルド環境でのコード実行**になる)・部品の動的な属性(`:items="…"` は式として評価される)・
 * markdown-it-attrs の `{…}` の記法が注入になる。
 *
 * ## 設計: 既定で拒否する(Markdown 処理系の解釈を真似ない)
 *
 * フェンス・インラインコード・HTML ブロック・コメントを読み分けると、処理系との解釈の食い違いが抜け道になる(監査で繰り返し実測された)。そこで**全ての行**で、
 * コードの中・コメントの中・HTML ブロックの中も含めて、次を割る(U+200B を挟む。コードの中の見た目の変化は受け入れる):
 *   1. `{{` と `}}` の間、`{` の直後(式としても markdown-it-attrs の記法としても読まれない)。文字参照の `{` が次の `{` と隣り合って復号されるのも止める。
 *      例外は `{n}`(英数字と `_` だけ)だけ。見出しのアンカー `{#id}` も割る(生成器が出す見出しの行は完全一致で登録する)
 *   2. `<` の直後(タグでもコメントでも `<!--` でもなくなる)。例外は下の許可表に合うタグだけ(中の `{` と `<` も割る)
 *
 * ## 例外は生成器の登録だけ
 *
 * 割らずにそのまま出すものは、生成器が**登録簿**(`kernel/trusted-html.ts`。メモリの上だけ。出力に印は無い)に登録した完全一致の文字列だけである:
 * 部品の見本・実装が描いた画面のプレビュー・生成器が書いたコードの抜粋や図のフェンス・全体が生成物であるという宣言のコメント(`snippets`)。
 * 登録された文字列の中でも `{{` と `}}` は割る。部品の式の属性(`:items` / `:cells`)は、生成器の直列化(`jsonAttr`)が出して登録した値だけを通し、
 * さらに Vue と同じ復号(`&amp;` `&#39;`)で読み直した JSON を同じ直列化で書き直して**バイトが一致する**ことを要求する(文字参照で引用符を抜けさせない)。
 *
 * ## 許可表のタグ
 *
 * 登録されていないタグは、許可表(`ALLOWED_TAGS`。構造のタグと SVG と部品)の名前と属性(`ALLOWED_ATTRIBUTES`・`data-*`・`aria-*`・スロット `#名前`)に合うものだけ通す。
 * `on*`・`v-*`・`@*`・`srcdoc`・`pre`・`textarea`・フォーム部品は通らない。`href` / `src` は相対(`//` と `\` で始まらない)か `http(s)` / `mailto` / `#`、
 * `style` は CSS のカスタムプロパティの宣言だけ、`id` / `name` は予約された名前(`app` や VitePress のもの・`window` などの DOM の名前)を除く。
 *
 * ## 釣り合い(登録されていない文字列のタグ)
 *
 * 許可表に合うだけでは通さない。仕様の文字列が作る閉じていない `<div>`・余分な `</div>`・置き場の違う `<template #名前>` はサイトの Vue のコンパイルを壊すので、
 * ページ全体の積みで対になったタグだけを通し、Markdown が対を別々の要素にまたがせる形(行の途中の開きと行頭の閉じ・強調やコードや表のセルをまたぐ対・
 * 閉じていないフェンスの中)は通さない(`book-sanitize-balance.ts`)。複数行の構造を生成器が登録した断片として出せば、この制約は受けない。
 * 追跡は**出力と同じ文字列**を読む: 文字列を変える前段(登録外の行頭の柵を割る・登録した柵の前の空行)は追跡の前に済ませる(`reshape`。割った柵がコードスパンの対を組み替えるため)。
 * 登録は**ページごと・生成の実行ごと**(`kernel/trusted-html.ts` の切り出しと初期化)で、登録されたコードの柵の前には空行を置く。
 *
 * 冪等(2 回掛けても同じ)。**アプリの語彙は 1 語も持たない**。
 */

import { currentTrusted, type TrustedHtml } from '../kernel/trusted-html.js';
import { collectValidTags, type ValidTags } from './book-sanitize-balance.js';
import { ZWSP } from '../kernel/html-allow-list.js';

/** `{` を表す字面: `{` 自身と、文字参照(`&#123;` `&#x7b;` `&lbrace;` `&lcub;`)。 */
const BRACE_TOKEN = /\{|&#0*123;|&#x0*7b;|&lbrace;|&lcub;/gi;

/**
 * Vue の式と属性の記法の記号を割る(コードの中も含む)。
 *
 * `{` の直後に U+200B を挟む(`{{` は式として読まれず、`{v-html=…}` のような markdown-it-attrs の記法も別の綴りになる)。
 * 文字参照の `{` は、**直後が `{` か別の `{` の字面のとき**だけ U+200B を挟む(`&#123;{` が復号されて `{{` になるのを止める。生成器の `esc` が出す
 * `&#123;n&#125;` は変わらない)。`}}` の間にも挟む。さらに `{` から次の `}`(または行末)までの**空白の後ろ**にも挟む(markdown-it-attrs は `{` の直後の零幅の文字を
 * 属性名の一部として読み、空白で属性を区切るので、`{<ZWSP> #app}` は 2 つ目の属性 `#app` が `id="app"` になる。どの属性名も零幅の文字で始まれば `id` にも `class` にもならない)。
 * 例外: 英数字と `_` だけの `{n}`。
 */
function neutralizeBraces(text: string): string {
  return text
    .replace(BRACE_TOKEN, (token, offset: number) => {
      const rest = text.slice(offset + token.length);
      if (rest.startsWith(ZWSP)) return token;
      if (token === '{') return /^[A-Za-z0-9_]+\}/.test(rest) ? token : `{${ZWSP}`;
      return /^(?:\{|&#0*123;|&#x0*7b;|&lbrace;|&lcub;)/i.test(rest) ? `${token}${ZWSP}` : token;
    })
    .replace(/\}\}/g, `}${ZWSP}}`)
    // markdown-it-attrs は `{` の直後の零幅の文字を属性名の一部として読み、空白で属性を区切る(`{<ZWSP> #app}` は 2 つ目の属性 `#app` が `id="app"` になる)。
    // そこで `{` から次の `}` まで(または行末まで)の空白の後ろにも零幅の文字を挟む: どの属性名も零幅の文字で始まり、`id` にも `class` にもならない
    // (書き方が `#名前` でも `id=名前` でも、空白・タブ・`/` `=` の後でも同じ。リンクに飲まれても `{` と `}` の対の中は変わらない)
    .replace(/\{[^}\n]*/g, (region) => region.replace(SPACE_WITHOUT_ZWSP, ` ${ZWSP}`))
    // VitePress の容器(`::: tip` `::: details` `::: v-pre` `::: code-group`)は、行頭の `:::` で始まり、中身の構造(タグの対)を変える。`:` が 3 つ以上続く所を割る
    .replace(/:(?=::)/g, `:${ZWSP}`);
}

/** 零幅の文字が続かない空白。 */
const SPACE_WITHOUT_ZWSP = new RegExp(` (?!${ZWSP})`, 'g');

/** `<` の直後に U+200B を挟む(すでに挟んであれば何もしない)。 */
function neutralizeAngles(text: string): string {
  return text.replace(/<(?!​)/g, `<${ZWSP}`);
}

/** 割る(`{` と `<`)。 */
function breakAll(text: string): string {
  return neutralizeAngles(neutralizeBraces(text));
}

/** 通したタグを写す。式の属性の値の範囲のほかは、`{` と `<` を割る(属性の値の中の `{{` も効かせない)。 */
function copyAllowedTag(tag: string, ranges: readonly (readonly [number, number])[]): string {
  // 先頭の `<` はタグ自身(許可した)なので割らない。属性の値の中の `<` と `{` を割る。
  let out = '<';
  let from = 1;
  for (const [start, end] of ranges) {
    out += breakAll(tag.slice(from, start)) + tag.slice(start, end);
    from = end;
  }
  return out + breakAll(tag.slice(from));
}

/** そのまま写す範囲(登録された文字列と、見出しのアンカー)。 */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly kind: 'trusted';
}

/** 登録簿の文字列の先頭 8 字での索引(登録簿の大きさが変わるまで使い回す)。 */
const SNIPPET_INDEX = new WeakMap<Set<string>, { readonly size: number; readonly byHead: Map<string, readonly string[]> }>();

function snippetIndex(snippets: Set<string>): Map<string, readonly string[]> {
  const cached = SNIPPET_INDEX.get(snippets);
  if (cached?.size === snippets.size) return cached.byHead;
  const byHead = new Map<string, string[]>();
  for (const snippet of snippets) {
    const head = snippet.slice(0, 8);
    byHead.set(head, [...(byHead.get(head) ?? []), snippet].sort((a, b) => b.length - a.length));
  }
  SNIPPET_INDEX.set(snippets, { size: snippets.size, byHead });
  return byHead;
}

/** 本文の中の、登録された文字列の完全一致の範囲(重ならない。先に始まるもの・長いものを優先)。 */
function trustedSpans(text: string, snippets: Set<string>): Span[] {
  if (snippets.size === 0) return [];
  const byHead = snippetIndex(snippets);
  const spans: Span[] = [];
  let index = 0;
  while (index < text.length) {
    const candidates = byHead.get(text.slice(index, index + 8));
    const hit = candidates?.find((snippet) => text.startsWith(snippet, index));
    if (hit !== undefined) {
      spans.push({ start: index, end: index + hit.length, kind: 'trusted' });
      index += hit.length;
    } else {
      index += 1;
    }
  }
  return spans;
}

/** 範囲の外の文字列を割る(タグは釣り合いのとれた許可表のものだけ残す)。 */
function breakText(text: string, base: number, valid: ValidTags): string {
  let out = '';
  let plain = '';
  let index = 0;
  const flush = (): void => {
    out += neutralizeBraces(plain);
    plain = '';
  };
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '<') {
      const tag = valid.get(base + index);
      if (tag === undefined) {
        plain += text.charAt(index + 1) === ZWSP ? '<' : `<${ZWSP}`;
        index += 1;
        continue;
      }
      flush();
      out += copyAllowedTag(text.slice(index, index + tag.length), tag.expressionRanges);
      index += tag.length;
      continue;
    }
    plain += char;
    index += 1;
  }
  flush();
  return out;
}

/** 手数の予算を超えたページは、タグを 1 つも通さず(全部割る)、名指しの問題にして書き込みの出口に止めさせる。 */
function reportBudget(trusted: TrustedHtml): void {
  const message = 'ハンドブックの無害化が手数の予算を超えました(極端に長い行・深い入れ子・記号の連なりが仕様の文字列にあります)。そのページは書きません';
  if (!trusted.problems.includes(message)) trusted.problems.push(message);
}

/** 登録された範囲の最初の行が、コードの柵の開き（字下げ・引用 `>`・リスト記号の後の ``` か ~~~）か。引用つきの柵（`> ` ```` ```yaml ````）も含む。 */
const REGISTERED_FENCE_START = /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*(?:`{3}|~{3})/;

/** 行頭(字下げ・引用・リストの記号だけが前にある)の 3 つ以上のバッククォートかチルダの連なり。 */
const FENCE_OPENING = /^((?:[ \t>]|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*)(`{3,}|~{3,})/gm;

/**
 * 登録されていない文字列の、行頭の ``` と ~~~ の連なりを 1 字ずつ割る(間に U+200B)。仕様の文字列はコードの柵を開けない。
 * VitePress は柵の情報文字列の先頭の語を `class="language-…"` と `<span class="lang">` に**エスケープせずに**書くので、
 * 引用符を含む情報文字列(```` ```x"y ````)は属性を壊して Vue のコンパイルが落ちる。生成器の柵は登録簿の完全一致で通る。
 *
 * @param text 登録されていない文字列
 * @param atLineStart この文字列の先頭が行頭か
 */
function breakFences(text: string, atLineStart: boolean): string {
  return text.replace(FENCE_OPENING, (whole: string, prefix: string, run: string, offset: number) =>
    offset === 0 && !atLineStart ? whole : prefix + [...run].join(ZWSP),
  );
}

/**
 * 文字列を変える前段(登録外の行頭の柵を割る・登録した柵の前に空行を置く)を済ませ、登録された範囲を新しい位置に写す。
 *
 * 釣り合いの追跡(`collectValidTags`)は、**出力と同じ文字列**を読まなければならない。行頭の ``` を割ると、割る前は同じ行の次の ``` と対だった連なりが
 * 1 字ずつになり、`` `<ZWSP>` `` が 1 つのコードスパンになって、残りの ``` は別の連なりと対になる。割る前の文字列で対を数えると、対だと数えたタグの片方だけが
 * 出力ではコードスパンに飲まれる(`` ``` ```<details>```>```</details> `` → 開きはコードの中・閉じは生のタグ → Vue のコンパイルの誤り。種 63854354 の乱択)。
 * 登録した柵の前の空行も段落とコードスパンの続きを切るので、同じく追跡の前に足す。この後の処理(`{` と `<` の後ろに U+200B を挟む)は、
 * バッククォートの対も行と段落の切れ目も変えない。
 *
 * @param markdown 行の区切りをそろえた全体
 * @param spans 登録された範囲(昇順・重ならない)
 * @returns 前段を済ませた全体と、その中の登録された範囲
 */
function reshape(markdown: string, spans: readonly Span[]): { readonly markdown: string; readonly spans: readonly Span[] } {
  let out = '';
  const moved: Span[] = [];
  let position = 0;
  for (const span of spans) {
    out += breakFences(markdown.slice(position, span.start), out === '' || out.endsWith('\n'));
    // 登録されたコードの柵(引用つき・リストの中のものも)は、前に空行を置く(直前の行が HTML ブロックだと、柵ごと生の HTML として読まれ、柵の中の `<script>` などが生きてしまう)
    if (REGISTERED_FENCE_START.test(markdown.slice(span.start, span.start + 400)) && out !== '' && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '\n\n';
    moved.push({ start: out.length, end: out.length + span.end - span.start, kind: 'trusted' });
    out += markdown.slice(span.start, span.end);
    position = span.end;
  }
  return { markdown: out + breakFences(markdown.slice(position), out === '' || out.endsWith('\n')), spans: moved };
}

/**
 * Markdown の生成部分を無害化する。
 *
 * @param source 生成した Markdown(複数行)
 * @param trusted 生成器が登録した例外の登録簿(省略は今の登録簿)
 * @param stepsPerChar 手数の予算(1 字あたり。省略は既定。テスト用)
 * @returns 無害化した Markdown
 */
export function sanitizeBookMarkdown(source: string, trusted: TrustedHtml = currentTrusted(), stepsPerChar?: number): string {
  // 行の区切りは `\n` にそろえる(markdown-it も `\r\n` と `\r` を `\n` にそろえてから読む。行の判定を 1 通りにする)
  const normalized = source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
  // 文字列を変える前段を先に済ませ、釣り合いの追跡は出力と同じ文字列を読む
  const { markdown, spans } = reshape(normalized, trustedSpans(normalized, trusted.snippets));
  const { valid, exhausted } = collectValidTags(markdown, spans, trusted, stepsPerChar);
  if (exhausted) reportBudget(trusted);
  let out = '';
  let position = 0;
  for (const span of spans) {
    out += breakText(markdown.slice(position, span.start), position, valid);
    out += markdown.slice(span.start, span.end).replace(/\{\{/g, `{${ZWSP}{`).replace(/\}\}/g, `}${ZWSP}}`);
    position = span.end;
  }
  return out + breakText(markdown.slice(position), position, valid);
}
