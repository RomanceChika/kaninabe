/**
 * リンクの実在を見る対象(M4)を読むローダー。
 *
 * **範囲は閉じた集合**: 呼び出し側が渡す根の文書(`CLAUDE.md`)と、`docs/` の下の全部の `.md`
 * (`node_modules` と `.vitepress` の下・`template.md` / `template.*.md` は読まない — VitePress の `srcExclude` と同じ。テンプレートは行き先の穴を持つ。生成物の html も読まない)。
 * `loadDocs`(規約文書・仕様文書・W 層。フロントマターを持つ文書の台帳)とは別の読みで、
 * こちらはフロントマターの有無を問わず、設計文書・引き継ぎ・README・テンプレートまで全部を見る。
 *
 * ファイル I/O(走査・実在判定)だけを持ち、リンクの取り出しは `markdown-links.ts` の純粋関数に委ねる。
 */

import { readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { isDirectory, isFile, toRelative, walkFiles } from '../../io/paths.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';
import { extractLinks, type RawLink } from './markdown-links.js';
import type { DocLink, LinkedFile } from './types.js';

/** docs/ の直下で読まないディレクトリ(VitePress の `srcExclude` と同じ。依存と生成物の置き場)。 */
const SKIPPED_DIRS: readonly string[] = ['node_modules', '.vitepress'];

/** docs/ の外で、リンクの実在を見る根の文書(リポジトリの根からの相対。範囲の閉じた集合の片方。もう片方は docs/ の下の全部)。 */
export const LINKED_ROOT_FILES: readonly string[] = ['CLAUDE.md'];

/** テンプレート(プレースホルダーのリンクを持つ。VitePress の `srcExclude` と同じ)。 */
const TEMPLATE_NAME = /^template(\..+)?\.md$/;

/** `scanLinkedFiles` の入力。パスはすべて絶対パス(根の文書だけ根からの相対)。 */
export interface LinkScanOptions {
  /** Finding の location.file の基準。 */
  readonly repoRoot: string;
  /** VitePress のサイトルート(= docs/)。`/` 始まりのリンクの基準で、走査の起点。 */
  readonly docsRoot: string;
  /** リポジトリの根にある、docs/ の外で読む文書(例: `CLAUDE.md`)。無いものは読まない。 */
  readonly rootFiles: readonly string[];
}

/** `scanLinkedFiles` の結果。 */
export interface LinkScanResult {
  readonly linked: LinkedFile[];
  /** 読めなかったファイルの指摘(M4)。 */
  readonly findings: Finding[];
}

/**
 * 範囲の全ファイルを読み、相対リンクを解決して実在を判定する。
 *
 * @param options 走査の根
 * @returns リンクを読んだファイル(名前順)と、読めなかったファイルの指摘
 */
export function scanLinkedFiles(options: LinkScanOptions): LinkScanResult {
  const roots = options.rootFiles.map((name) => join(options.repoRoot, name)).filter(isFile);
  const docs = walkFiles(options.docsRoot, (name) => name.endsWith('.md') && !TEMPLATE_NAME.test(name), SKIPPED_DIRS);
  const result: LinkScanResult = { linked: [], findings: [] };
  for (const absolute of [...roots, ...docs]) {
    const file = toRelative(options.repoRoot, absolute);
    try {
      const links = extractLinks(readFileSync(absolute, 'utf8')).map((link) => resolveLink(link, absolute, options));
      result.linked.push({ file, links });
    } catch (cause) {
      result.findings.push(
        makeFinding('M4', {
          message: `ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
          location: { file },
          suggestion: 'ファイルの権限とパスを確認する',
        }),
      );
    }
  }
  return result;
}

/**
 * 相対リンクを解決し、実在するかを判定する。
 *
 * `/` で始まるリンクは VitePress のサイトルート(= docs/)から、それ以外はリンク元ファイルのディレクトリから解決する。
 * アンカー(`#…`)とクエリは外し、ファイルだけを見る。docs/ の外(実装の木など)を指すリンクもファイルの実在だけは確認する。
 */
function resolveLink(link: RawLink, fromAbsolute: string, options: LinkScanOptions): DocLink {
  const bare = decoded((link.href.split('#')[0] ?? '').split('?')[0] ?? '');
  const absolute = bare.startsWith('/') ? join(options.docsRoot, bare) : resolve(dirname(fromAbsolute), bare);
  return {
    href: link.href,
    target: toRelative(options.repoRoot, absolute),
    exists: bare === '' || targetExists(absolute, options.docsRoot),
    line: link.line,
  };
}

/** `%20` などのパーセント符号を戻す(壊れた符号はそのまま)。 */
function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * リンク先が実在するか。
 * docs/ の中のディレクトリへのリンクは VitePress が README.md / index.md を引くため、どちらかがあれば実在とみなす
 * (docs/ の外のディレクトリは、あれば実在)。拡張子の無いリンクは `.md` の補完も試す。
 */
function targetExists(absolute: string, docsRoot: string): boolean {
  if (isFile(absolute)) return true;
  if (isDirectory(absolute)) {
    if (!isInside(docsRoot, absolute)) return true;
    return isFile(join(absolute, 'README.md')) || isFile(join(absolute, 'index.md'));
  }
  return extname(absolute) === '' && isFile(`${absolute}.md`);
}

/** `path` が `base` の中(または `base` 自身)か。 */
function isInside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
