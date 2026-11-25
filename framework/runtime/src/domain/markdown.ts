/**
 * 書式つきの本文(`format: markdown` の欄)を、画面に出せる HTML にする**唯一の口**と、素の文の取り出し。
 *
 * **仕様**: 欄の `format: markdown`(entity_spec)。生成する画面の部品(`@kaninabe/runtime/markdown-view` の `MarkdownView`)は
 * この関数の出力だけを描く。実装の木では `dangerouslySetInnerHTML` を ESLint(`layer/no-raw-html`)が止めるので、
 * 本文を HTML にして DOM に載せる経路は、ここを通るものしか残らない(ASVS V1.3.1・V1.3.5)。**外への送信は無い**(手元で描く)。
 *
 * ## 安全の線(許可リストで通す。生の HTML は通さない)
 *
 * 1. **生の HTML は、構文木にする時点で捨てる**(`remark-rehype` の既定。`<script>` も `<img onerror>` も文字ごと消える。
 *    `allowDangerousHtml` は付けない)。
 * 2. 構文木を **`rehype-sanitize` の許可リスト**に通す。**既定のスキーマを引くのではなく、通す要素と属性を明示して足す**
 *    (将来ライブラリの既定が広がっても、ここで宣言していないものは通らない)。通るのは見出し・段落・改行・強調・削除・コード・
 *    整形済み・引用・リスト・区切り線・リンクだけ。属性は `a[href]`・`ol[start]`・`code[class="language-…"]` だけ
 *    (`style`・`id`・イベント属性・`target` は無い)。画像・表・フォーム・iframe・script・style は許可リストに無い。
 * 3. リンクは **`safeHttpUrl`(絶対 URL の http / https だけ)を通ったものだけ**を残す。通らないもの(`javascript:`・`data:`・
 *    相対・プロトコル相対・`mailto:`・ユーザー名つき)は**アンカーを外して文字だけ**にする。残したリンクには
 *    `rel="noopener noreferrer"` を付ける(`target` は付けない = 外部リンクも同じタブで開く)。読める文字の無いリンクは落とす。
 * 4. 見出しの階層を 1 段下げる(本文の `#` がページの `h1` と並ばないように)。
 *
 * ## 描けない本文は素の文で出す
 *
 * 引用(`>`)やリストを数千段重ねた本文は、木の再帰(ライブラリ側を含む)が `RangeError` になりうる。入れ子の深さを数えて断る
 * のではなく、**失敗を受け止めて素の文に縮退する**(原因が何でも・ライブラリが替わっても効く)。縮退した出力も同じ線の内側にある
 * (全文をエスケープするだけで、HTML の要素は `<p>` と `<br>` 以外生まない)。長さが `MARKDOWN_RENDER_LIMIT` を超える本文も
 * 解釈せず縮退する(解釈の計算量の上限。`format: markdown` の欄の `max_length` もこれ以下)。
 */

import type { Nodes as HastNodes, Root as HastRoot } from 'hast';
import type { Nodes as MdastNodes } from 'mdast';
import rehypeSanitize from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { safeHttpUrl } from './url.js';

/**
 * 解釈する本文の長さの天井(`format: markdown` の欄の `max_length` もこれ以下)。これを超える本文は解釈せず素の文で出す。
 * 8,000 字は実測で決めた: 解釈の時間は本文の長さの 2 乗に近く伸びる悪い入力があり(`*a_` の繰り返し 15,000 字で約 1.8 秒・
 * `*a` の繰り返し 50,000 字で約 10 秒)、8,000 字なら最悪でも約 0.5 秒に収まる(`__tests__/markdown.test.ts` の時間の枠が見張る)。
 */
export const MARKDOWN_RENDER_LIMIT = 8_000;

/** 本文の見出し(`#`)がページの見出し(`h1`)と並ばないよう、1 段下げた先の見出し(`h6` は動かない)。 */
const HEADING_DEMOTION: Readonly<Record<string, string>> = {
  h1: 'h2',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
  h6: 'h6',
};

/**
 * 通す要素の許可リスト(Markdown の記法が作りうる要素のうち、無害な骨格だけ)。
 * 画像(`img`・`picture`・`source`)・表・フォーム・埋め込み・スクリプトは載せない。
 */
export const ALLOWED_TAGS: readonly string[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
];

/** 許可リストのスキーマ(既定のスキーマに足すのではなく、ここで宣言したものだけが通る)。 */
const SCHEMA: SanitizeSchema = {
  tagNames: [...ALLOWED_TAGS],
  attributes: {
    a: ['href'],
    ol: ['start'],
    // フェンスコードの言語の印(`language-ts`)だけ。任意の class は通さない。
    code: [['className', /^language-[A-Za-z0-9_+-]{1,30}$/u]],
  },
  protocols: { href: ['http', 'https'] },
  // 中身ごと捨てる要素(許可リストに無い要素は外側だけが外れ、中の文字が残る。script と style は文字も残さない)。
  strip: ['script', 'style'],
  clobber: [],
  allowComments: false,
  allowDoctypes: false,
};

/** 木の中に、読める文字が 1 つでもあるか(空白だけ・要素だけの殻は「無い」)。 */
function hasText(node: HastNodes): boolean {
  if (node.type === 'text') return node.value.trim() !== '';
  return 'children' in node && node.children.some(hasText);
}

/**
 * 子の並びを整える(深いほうから): 見出しを 1 段下げ、リンクは `safeHttpUrl` を通ったものだけ残して `rel` を付け、
 * 通らないリンクはアンカーを外して中身だけにし、**読める文字の無いリンクは落とす**。
 */
function finishNodes<T extends HastNodes>(nodes: readonly T[]): T[] {
  const finished: HastNodes[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') {
      finished.push(node);
      continue;
    }
    node.children = finishNodes(node.children);
    // 許可リストに合わず値を失った class は、空の属性として残さない。
    if (Array.isArray(node.properties['className']) && node.properties['className'].length === 0) delete node.properties['className'];
    node.tagName = HEADING_DEMOTION[node.tagName] ?? node.tagName;
    if (node.tagName !== 'a') {
      finished.push(node);
      continue;
    }
    const href = safeHttpUrl(typeof node.properties['href'] === 'string' ? node.properties['href'] : null);
    if (!hasText(node)) continue;
    if (href === null) {
      finished.push(...node.children);
      continue;
    }
    node.properties = { href, rel: ['noopener', 'noreferrer'] };
    finished.push(node);
  }
  return finished as T[];
}

/** サニタイズのあとの整形(`finishNodes`)。 */
function finishPlugin() {
  return (tree: HastRoot): void => {
    tree.children = finishNodes(tree.children);
  };
}

/** 本文用の変換器(組み立てて使い回す)。 */
const toHtml = unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize, SCHEMA).use(finishPlugin).use(rehypeStringify);

/** 素の文を取るためだけの構文解析器。 */
const toTree = unified().use(remarkParse);

/** 素の文を HTML に出せる形にする(`&` `<` `>` `"` `'` をエスケープ)。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

/** 描けない本文の縮退: 記法を解かず、空行で区切った段落の素の文として出す。 */
function plainParagraphs(body: string): string {
  return body
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeHtml(block).replace(/\n/gu, '<br>')}</p>`)
    .join('');
}

/**
 * Markdown の本文を、サニタイズ済みの HTML にする。**例外は投げない**。
 *
 * 見出し・段落・リスト・強調・引用・コード・区切り線・リンクを通す。生の HTML・画像・表は消える(文字は残る)。
 * 安全でない URL のリンクはアンカーが外れて文字だけになり、安全なリンクには `rel="noopener noreferrer"` が付く。
 * 描けない本文(深すぎる入れ子・長すぎる本文)は素の文の段落に縮退する。
 *
 * @param body - Markdown の本文
 * @returns HTML の断片(`MarkdownView` だけが DOM に載せる。上記の線を通したものだけ)
 */
export function renderMarkdown(body: string): string {
  if (body.length > MARKDOWN_RENDER_LIMIT) return plainParagraphs(body);
  try {
    return String(toHtml.processSync(body));
  } catch {
    return plainParagraphs(body);
  }
}

/** 文の中の連なり(間に空白を挟まない親)。ほかの親は子の間を空白で区切る。 */
const PHRASING_PARENTS: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
]);

/** 構文木から素の文字を集める(生の HTML・画像・定義は捨てる)。 */
function textOf(node: MdastNodes): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value;
  if (node.type === 'break') return ' ';
  if (!('children' in node)) return '';
  const parts = (node.children as readonly MdastNodes[]).map(textOf);
  return parts.join(PHRASING_PARENTS.has(node.type) ? '' : ' ');
}

/**
 * 素の文を、空白をたたんで `limit` 字(コードポイント)に収める。長いときは末尾を `…` にする。
 *
 * @param text - 素の文(改行・連続する空白を含んでよい)
 * @param limit - 返す字数の上限(`…` を含む)
 * @returns 収めた文。文字が無ければ空文字
 */
export function excerptOf(text: string, limit: number): string {
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`;
}

/**
 * Markdown の本文から、先頭の素の文(記法を剥がしたもの)を取る。OGP の説明文に使う。**例外は投げない**。
 *
 * 改行・連続する空白は 1 つの空白にたたむ。長いときは `limit` 字に収める(`excerptOf`)。
 * 深い入れ子で木を歩けないとき・長すぎる本文のときは(`renderMarkdown` と同じ理由)、記法を剥がさず本文の先頭をそのまま使う。
 *
 * @param body - Markdown の本文
 * @param limit - 返す字数の上限(`…` を含む)
 * @returns 素の文。本文に文字が無ければ空文字
 */
export function plainTextOf(body: string, limit: number): string {
  if (body.length > MARKDOWN_RENDER_LIMIT) return excerptOf(body.slice(0, limit * 4), limit);
  try {
    return excerptOf(textOf(toTree.parse(body)), limit);
  } catch {
    return excerptOf(body, limit);
  }
}
