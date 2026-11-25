/**
 * Markdown 本文から見出しを取り出す純粋関数群。
 *
 * 必要なのは「ATX 見出し」だけなので、行走査で閉じている(説明しやすさを優先)。
 * **リンクはここでは読まない** —— リンクの読み手は構文木を使う `markdown-links.ts` の 1 つだけである。
 *
 * 走査から除外するもの:
 *   - YAML フロントマター(先頭の `---` ブロック)
 *   - フェンス付きコードブロック(``` / ~~~)
 *   - HTML コメント(1 行・複数行とも)
 *
 * 見出しは AUTO-GENERATED ブロックの中も拾う。生成された見出しも文書の構造の一部であり、
 * テンプレート(M5)はそれを含めた H2 の集合を定めているため。
 */

import type { DocHeading } from './types.js';

/** parseMarkdown の結果。 */
export interface ParsedMarkdown {
  /** 本文の見出し(出現順)。 */
  readonly headings: readonly DocHeading[];
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_COMMENT = /<!--.*?-->/g;
const HEADING_ANCHOR = /\{#[^}]*\}\s*$/;
const HEADING_ANNOTATION = /[（(](?:任意|必須|省略可|OPTIONAL[^）)]*)[）)]/g;

/**
 * Markdown ソース全体を走査して見出しを取り出す。
 *
 * @param source ファイルの中身(フロントマター込み)
 * @returns 見出し。行番号はファイル先頭からの 1 始まり
 */
export function parseMarkdown(source: string): ParsedMarkdown {
  const lines = source.split('\n');
  const headings: DocHeading[] = [];
  const state = { fence: null as string | null, inComment: false };

  for (let i = skipFrontmatter(lines); i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (handleFence(raw, state)) continue;
    const text = stripComments(raw, state);
    if (text.trim() === '') continue;

    const heading = matchHeading(text, i + 1);
    if (heading !== null) headings.push(heading);
  }
  return { headings };
}

/**
 * 見出し文字列を比較用に正規化する。
 * アンカー(`{#statement}`)と `(任意)` などの注記を落とし、前後の空白を詰める。
 *
 * @param text 見出しの生テキスト
 * @returns 正規化した見出し名
 */
export function normalizeHeading(text: string): string {
  return text.replace(HEADING_ANCHOR, '').replace(HEADING_ANNOTATION, '').trim();
}

/** 見出しに `(任意)` 系の注記が付いているか(テンプレート側で「省略可」を意味する)。 */
export function isOptionalHeading(text: string): boolean {
  return /[（(](?:任意|省略可|OPTIONAL[^）)]*)[）)]/.test(text);
}

/**
 * その見出し文字列が繰り返しパターンか。
 * `{リソース名}` のようなプレースホルダーか `N:` の連番を含むものを指す。
 *
 * 末尾のアンカー(`{#statement}`)は判定前に落とす。アンカーは見出しの参照先を固定するもので、
 * 文書ごとに増減する繰り返しではない(これを繰り返しと誤判定すると、
 * アンカー付きテンプレート配下の文書が M5 の対象から丸ごと外れる)。
 */
export function isRepeatableHeading(text: string): boolean {
  const body = text.replace(HEADING_ANCHOR, '');
  return /\{[^}]+\}/.test(body) || /N[:：]/.test(body);
}

/** 先頭の YAML フロントマターの区切りの状態。 */
export type FrontmatterDelimiter = 'none' | 'closed' | 'unclosed';

/**
 * 先頭の YAML フロントマターが `---` で閉じられているかを判定する。
 *
 * gray-matter は閉じ区切りが無くてもファイル末尾までをフロントマターとして読むため、
 * **途中で切れたファイルが「フロントマターだけの正常な文書」として通ってしまう**。
 * 実際に docs/specs/backend/actions/README.md がその形(155 バイト・本文なし)で
 * コミットされ、検証を素通りした(NOTES「バックログ掃除完了」)。
 * gray-matter の解釈とは別に、区切りの構造だけをここで見る。
 *
 * **既知の限界**(いずれも見逃す側に寄る。テストで現状の挙動を固定してある):
 *   1. 本文中の水平線 `---` を閉じ区切りと見なす。閉じ忘れたまま本文が続く文書は
 *      「閉じている」と判定され、飲み込まれた本文が YAML として解釈可能な形なら
 *      gray-matter もエラーにしないため、両方の検査をすり抜ける。
 *   2. 閉じ区切りがある限り、本文が丸ごと空でもここでは何も言わない
 *      (README なら M5 の「見出しがひとつもありません」が warning で拾う)。
 * 本気で塞ぐなら「区切りの行番号を返し、本文の実体があるかまで見る」形になるが、
 * 実害が観測されている形(1 の逆・区切りが最後まで現れない)はこの判定でエラーになる。
 *
 * @param source ファイルの中身
 * @returns フロントマターが無い / 閉じている / 開いたまま切れている、のいずれか
 */
export function frontmatterDelimiter(source: string): FrontmatterDelimiter {
  const lines = source.replace(/^\uFEFF/, '').split('\n');
  if ((lines[0] ?? '').trim() !== '---') return 'none';
  return closingDelimiterLine(lines) === null ? 'unclosed' : 'closed';
}

/** 先頭のフロントマターを閉じる `---` の行添字。フロントマターが無い / 閉じていなければ null。 */
function closingDelimiterLine(lines: readonly string[]): number | null {
  if ((lines[0] ?? '').trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '---') return i;
  }
  return null;
}

/**
 * 先頭の YAML フロントマターの行を空行に置き換えた本文を返す(行番号を変えない)。
 * フロントマターの `---` を構文木が水平線・見出しと読まないための前処理で、リンクの読み手(`markdown-links.ts`)が使う。
 */
export function blankFrontmatter(source: string): string {
  const lines = source.split('\n');
  const body = skipFrontmatter(lines);
  return [...lines.slice(0, body).map(() => ''), ...lines.slice(body)].join('\n');
}

/** 先頭の YAML フロントマターを読み飛ばし、本文が始まる行の添字を返す。 */
function skipFrontmatter(lines: readonly string[]): number {
  const closing = closingDelimiterLine(lines);
  return closing === null ? 0 : closing + 1;
}

/** コードフェンスの開閉を処理する。戻り値 true はこの行を読み飛ばすことを意味する。 */
function handleFence(raw: string, state: { fence: string | null }): boolean {
  const marker = FENCE.exec(raw)?.[1];
  if (state.fence === null) {
    if (marker === undefined) return false;
    state.fence = marker;
    return true;
  }
  const openChar = state.fence[0];
  if (marker !== undefined && marker[0] === openChar && marker.length >= state.fence.length) {
    state.fence = null;
  }
  return true;
}

/** HTML コメントを取り除いた行を返す。複数行コメントの内側なら空文字。 */
function stripComments(raw: string, state: { inComment: boolean }): string {
  if (state.inComment) {
    const end = raw.indexOf('-->');
    if (end === -1) return '';
    state.inComment = false;
    return stripComments(raw.slice(end + 3), state);
  }
  const text = raw.replace(INLINE_COMMENT, '');
  const open = text.indexOf('<!--');
  if (open === -1) return text;
  state.inComment = true;
  return text.slice(0, open);
}

/** ATX 見出しにマッチすれば DocHeading を返す。 */
function matchHeading(text: string, line: number): DocHeading | null {
  const m = HEADING.exec(text);
  if (m === null) return null;
  const level = (m[1] ?? '').length;
  const raw = (m[2] ?? '').trim();
  return { level, text: normalizeHeading(raw), raw, line };
}
