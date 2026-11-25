/**
 * Markdown 本文のリンクを、**構文木**から取り出す純粋関数(リンクの読み手はこの 1 つだけ)。
 *
 * 読むのは `link`(`[a](b)`・`<b>`)・`image`(`![a](b)`)・`definition`(`[a]: b`。参照リンクの行き先はここに載る)の 3 種で、
 * 構文木になるので次は自然に読まれない(正規表現で `](` を拾うと誤る所):
 *   - フェンス付きコード・インラインコード・HTML コメントの中の `[x](y)`
 *   - 入れ子の括弧・山括弧つきの行き先・参照の定義
 *
 * 除くもの:
 *   - 外部のリンク(`http:` `mailto:` など scheme つき・`//` 始まり)と、ページ内だけのアンカー(`#…`)・空の行き先
 *   - AUTO-GENERATED ブロックの中(生成物であり手で直せないため)。ブロックの境目は構文木の html 節で読む
 *   - YAML フロントマター(行番号を保ったまま空行にしてから読む)
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Nodes } from 'mdast';
import { blankFrontmatter } from './parse-markdown.js';

/** 本文中のリンク 1 つ(実在判定前)。 */
export interface RawLink {
  /** Markdown に書かれたリンク先そのもの(アンカー込み)。 */
  readonly href: string;
  /** ファイル先頭からの行番号(1 始まり)。 */
  readonly line: number;
}

const AUTO_GENERATED_OPEN = /<!--\s*AUTO-GENERATED:[a-z0-9-]+\s*-->/;
const AUTO_GENERATED_CLOSE = /<!--\s*\/AUTO-GENERATED:[a-z0-9-]+\s*-->/;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const parser = unified().use(remarkParse);

/**
 * ソース全体から、実在を確かめるべき相対リンクを出現順に取り出す。
 *
 * @param source ファイルの中身(フロントマター込み)
 * @returns 相対リンク。行番号はファイル先頭からの 1 始まり
 */
export function extractLinks(source: string): RawLink[] {
  const found: RawLink[] = [];
  collect(parser.parse(blankFrontmatter(source)), { generated: false }, found);
  return found;
}

/** 節を文書の出現順に歩く。生成ブロックの中ではリンクを集めない。 */
function collect(node: Nodes, state: { generated: boolean }, found: RawLink[]): void {
  if (node.type === 'html') {
    if (AUTO_GENERATED_CLOSE.test(node.value)) state.generated = false;
    else if (AUTO_GENERATED_OPEN.test(node.value)) state.generated = true;
    return;
  }
  // 行き先(`url`)を持つ節は link・image・definition の 3 種だけ(mdast の型が保証する)。
  if (!state.generated && 'url' in node && isRelative(node.url)) {
    found.push({ href: node.url, line: node.position?.start.line ?? 1 });
  }
  if ('children' in node) for (const child of node.children) collect(child, state, found);
}

/** 相対のパスか(外部・アンカーだけ・空を除く)。 */
function isRelative(url: string): boolean {
  return url !== '' && !url.startsWith('#') && !EXTERNAL.test(url);
}
