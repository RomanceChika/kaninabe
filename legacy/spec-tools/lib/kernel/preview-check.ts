/**
 * 画面プレビュー(実装が描いた HTML の断片。製品が `previews` の根に置く、コミットされた入力の `*.html`)の**入口の検査**(純粋関数)。
 *
 * プレビューは出力の口(`html/markup.ts` の `previewFragment`)がそのまま置くので、置く**前に**、許可表(`PREVIEW_TAGS` と `PREVIEW_ATTRIBUTES`。フォーム部品を含む)に合うかを
 * 1 本ずつ検査する。コミットされた入力は信頼しない(PR が `<img onerror>`・`v-html`・`:items="[1,alert(1)]"`・`<iframe src=javascript:>` を持つ断片を足せる)。
 * 合わないものは**拒否**する: 理由を返し、章を組む呼び手が生成の前提の破れとして生成を止める(`preview-refusal.ts`。点検 13 回目 C13-8)。
 *
 * 許可表:
 *   - タグ: 構造のタグ・フォーム部品(`input` `button` `select` `option` `textarea` `form` `label`)・`dialog` `details`・SVG の基本。`script` `style` `iframe` `object` `embed` `template` `link` `meta` `base` は無い
 *   - 属性: `on*` `v-*` `@*` `:*` `#*` と `style` は無い(本の CSP の `style-src 'self'` が止める属性を表に置かない)。`action` は同じオリジンのパスだけ・`method` は get / post だけ。`href` / `src` は `&` を含まず、`javascript:` `data:` や `//` で始まらない。`id` / `name` は予約名を除く
 *   - 同じ名前の属性が 2 回あるタグは拒否(大文字小文字を区別しない。Vue のコンパイルが落ちる)
 *   - 引用符のない値・単引用符の値も、同じ許可表で読む(属性の書き方でなく中身を見る)
 *   - コメント・CDATA・処理命令・タグにならない `<` は無い
 *   - 空要素でない HTML の要素の `/>` は無い(ブラウザの解析器は `/` を読み捨て、開いたままにする。`<textarea/>` は章の残りを飲み込み、`<a href=…/>` は枠の外の段落を包む)。自分を閉じてよいのは `svg` の中の SVG の要素だけ
 *
 * **アプリの語彙は 1 語も持たない**。
 */

import { ATTRIBUTE, reservedName, safeUrl, TAG_START } from './html-allow-list.js';

/** プレビューに現れてよいタグ。 */
const PREVIEW_TAGS: ReadonlySet<string> = new Set(
  `
  a article aside b br button caption code dd details dialog div dl dt em footer form h1 h2 h3 h4 h5 h6 header hr i img input label li main nav ol option
  p section select small span strong summary sup sub table tbody td textarea tfoot th thead tr ul wbr svg g path rect text tspan circle line polygon polyline
`.split(/\s+/).filter((name) => name !== ''),
);

/** プレビューに現れてよい属性。`data-*` と `aria-*` は別に通す。 */
const PREVIEW_ATTRIBUTES: ReadonlySet<string> = new Set(
  `
  class id title href src alt type value name role width height rows cols min max step disabled required selected checked readonly readOnly maxLength
  colSpan rowSpan target rel for open placeholder multiple inert hidden autocomplete autoComplete tabindex tabIndex pattern accept method action
  viewBox d x y dx dy rx ry cx cy r x1 y1 x2 y2 points fill stroke stroke-width text-anchor transform xmlns
`.split(/\s+/).filter((name) => name !== ''),
);

/**
 * フォームの送り先として通す形(同じオリジンのパスだけ。`/` の次が `/` や `\\` でなく、パスの文字だけでできている)。
 * ログイン・ログアウトのようなサーバーの口へのフォーム送信を描いた断片が持つ(認証の口は POST のフォームで叩く)。
 */
const SAME_ORIGIN_ACTION = /^\/(?![/\\])[A-Za-z0-9._~\/-]*$/;

/** 閉じタグの無い要素。 */
const VOID: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'input', 'wbr']);

/** `/>` で閉じてよい SVG の要素(HTML の要素の `/` は解析器が読み捨てる)。 */
const SVG_SELF_CLOSING: ReadonlySet<string> = new Set(['svg', 'g', 'path', 'rect', 'text', 'tspan', 'circle', 'line', 'polygon', 'polyline']);

/** 属性 1 つの検査。 */
function attributeProblem(tag: string, name: string, value: string | undefined): string | null {
  if (/^on/i.test(name) || /^(v-|@|:|#)/.test(name)) return `属性 ${name}(${tag})は置けません`;
  if (!PREVIEW_ATTRIBUTES.has(name) && !/^(data|aria)-[A-Za-z0-9_-]+$/.test(name)) return `許可表に無い属性 ${name}(${tag})`;
  if (value === undefined) return null;
  if ((name === 'href' || name === 'src') && !safeUrl(value)) return `危険な ${name}(${tag}): ${value.slice(0, 40)}`;
  if (name === 'action' && !SAME_ORIGIN_ACTION.test(value)) return `危険な action(${tag}): ${value.slice(0, 40)}`;
  if (name === 'method' && !/^(?:get|post)$/i.test(value)) return `許可表に無い method(${tag}): ${value.slice(0, 40)}`;
  if ((name === 'id' || name === 'name') && (!/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(value) || reservedName(value))) return `予約された ${name}(${tag}): ${value.slice(0, 40)}`;
  if (/[<`]/.test(value)) return `属性の値に < か バッククォートがあります(${tag}.${name})`;
  return null;
}

/**
 * プレビューの断片を検査する。
 *
 * @param html 断片(1 行に畳む前でも後でもよい)
 * @returns 拒否の理由(空なら登録してよい)。最初の数件だけ
 */
export function previewProblems(html: string): readonly string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  let index = html.indexOf('<');
  while (index !== -1 && problems.length < 3) {
    const rest = html.slice(index, index + 20_000);
    const start = TAG_START.exec(rest);
    if (start === null) {
      problems.push(`タグにならない < があります: ${rest.slice(0, 20)}`);
      break;
    }
    const closing = start[1] === '/';
    const name = start[2] ?? '';
    if (!PREVIEW_TAGS.has(name)) {
      problems.push(`許可表に無いタグ ${name}`);
      break;
    }
    let cursor = start[0].length;
    if (closing) {
      const end = /^[ \t]*>/.exec(rest.slice(cursor));
      if (end === null) {
        problems.push(`閉じタグ ${name} が読めません`);
        break;
      }
      if (stack.pop() !== name) problems.push(`閉じタグ ${name} が開きと対になりません`);
      index = html.indexOf('<', index + cursor + end[0].length);
      continue;
    }
    const seen = new Set<string>();
    for (;;) {
      const attribute = ATTRIBUTE.exec(rest.slice(cursor));
      if (attribute === null) break;
      const attributeName = attribute[1] ?? '';
      const found = attributeProblem(name, attributeName, attribute[2] ?? attribute[3] ?? attribute[4]);
      if (found !== null) problems.push(found);
      // 同じ名前の属性が 2 回あると Vue のコンパイルが落ちる(大文字小文字は区別しない)
      if (seen.has(attributeName.toLowerCase())) problems.push(`属性 ${attributeName} が重複しています(${name})`);
      seen.add(attributeName.toLowerCase());
      cursor += attribute[0].length;
    }
    const end = /^[ \t]*\/?>/.exec(rest.slice(cursor));
    if (end === null) {
      problems.push(`タグ ${name} の属性が読めません: ${rest.slice(cursor, cursor + 30)}`);
      break;
    }
    const selfClosed = end[0].endsWith('/>');
    if (selfClosed && !VOID.has(name) && !(SVG_SELF_CLOSING.has(name) && (name === 'svg' || stack.includes('svg')))) problems.push(`閉じられない要素の /> です(${name})`);
    if (!VOID.has(name) && !selfClosed) stack.push(name);
    index = html.indexOf('<', index + cursor + end[0].length);
  }
  if (problems.length === 0 && stack.length > 0) problems.push(`閉じていないタグがあります: ${stack.join(' ')}`);
  return problems;
}

/**
 * 断片の改行を実体参照にする(検査する形と置く形を揃える)。
 *
 * @param html 断片
 */
export function flatFragment(html: string): string {
  return html.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, '&#10;');
}
