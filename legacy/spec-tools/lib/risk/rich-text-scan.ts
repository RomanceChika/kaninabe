/**
 * 書式つきの本文を**描いている場所**の走査(R15 の材料。I/O 境界)。
 *
 * 書式つきの本文を HTML にして画面に載せる口は、実行時パッケージの描画の口だけにある(`MarkdownView` /
 * `renderMarkdown` / `plainTextOf`。`dangerouslySetInnerHTML` などの差し込み口は ESLint の `layer/no-raw-html` が実装の木から締め出す)。
 * ここでは、実装の木(ソースの根の下)でその口に**何を渡しているか**を拾う。拾うのは名前が字面にある次の形に限る:
 *
 * ```
 * <MarkdownView value={row.body} … />      renderMarkdown(page.body)      plainTextOf(current.body, 120)
 * ```
 *
 * **名前でなく束縛で見る**: 口の名前が実行時パッケージの本物の import に解決できるものだけを拾う(同名のローカル定義・別モジュールの import は口ではない)。
 * 渡す式は欄の参照(`識別子(.識別子)*`。`?.` も可)にする —— 末尾の名前で、どの欄を書式つきの本文として描いているかを決められるようにするため。
 * 検証器はファイル I/O をしないので、読み取りはここで済ませて純粋なデータにして渡す(規約: scripts-code-quality.md)。
 */

import { join } from 'node:path';
import ts from 'typescript';
import { isDirectory, toRelative, walkFiles } from '../io/paths.js';
import { sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { isSourceFile, readText } from '../config/env-scan.js';
import { allowedImports, parseSource, resolveImport, walk } from '../config/import-binding.js';
import type { ImportSpec } from '../config/import-binding.js';

/** 本文を描く口の名前。 */
export type RichTextSink = 'MarkdownView' | 'renderMarkdown' | 'plainTextOf';

/** 描く口に値を渡している 1 か所。 */
export interface RichTextSite {
  /** 渡しているファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 描く口。 */
  readonly sink: RichTextSink;
  /** 渡している式の字面(前後の空白を除いたもの)。 */
  readonly argument: string;
}

/** 走査結果。 */
export interface RichTextScan {
  /** 走査対象の木が 1 つでもあったか。 */
  readonly available: boolean;
  /** 描く口に渡している場所。 */
  readonly sites: readonly RichTextSite[];
}

/** 描く口の本物: 実行時パッケージの import(別名の import も可。同名のローカル関数・コンポーネント・別モジュールの import は口ではない)。 */
const SINKS: readonly ImportSpec[] = [
  { module: '@kaninabe/runtime/markdown-view', imported: 'MarkdownView' },
  { module: '@kaninabe/runtime/markdown', imported: 'renderMarkdown' },
  { module: '@kaninabe/runtime/markdown', imported: 'plainTextOf' },
];

/**
 * ソース 1 本の、本文を描く口への渡し方を集める(純関数)。TypeScript の構文木で、口の名前が本物の import に束縛されているものだけを拾う。
 * 拾う形は `<MarkdownView … value={式} …>` と `renderMarkdown(式…)` / `plainTextOf(式…)`(第 1 引数)。
 *
 * @param source ファイルの内容
 * @param file ファイル名(結果に載せる)
 * @returns 渡している場所(出現順)
 */
export function richTextSitesIn(source: string, file: string): readonly RichTextSite[] {
  const sourceFile = parseSource(source, file);
  const bound = allowedImports(sourceFile, SINKS);
  const sites: RichTextSite[] = [];
  if (bound.size === 0) return sites;
  walk(sourceFile, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      if (resolveImport(node.tagName, bound)?.imported !== 'MarkdownView') return;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'value') continue;
        if (attribute.initializer === undefined || !ts.isJsxExpression(attribute.initializer) || attribute.initializer.expression === undefined) continue;
        sites.push({ file, sink: 'MarkdownView', argument: attribute.initializer.expression.getText().trim() });
      }
      return;
    }
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const imported = resolveImport(node.expression, bound)?.imported;
    if (imported !== 'renderMarkdown' && imported !== 'plainTextOf') return;
    sites.push({ file, sink: imported, argument: (node.arguments[0]?.getText() ?? '').trim() });
  });
  return sites;
}

/**
 * 実装の木(ソースの根)を走査して、本文を描く口への渡し方を集める。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param productRoots 製品が宣言した根
 * @param layout 置き場の配置
 * @returns 走査結果
 */
export function scanRichTextSites(repoRoot: string, productRoots: ProductRoots, layout: ProductLayout): RichTextScan {
  const relative = sourceRootPath(layout, productRoots);
  const root = relative === null ? null : join(repoRoot, relative);
  if (root === null || !isDirectory(root)) return { available: false, sites: [] };
  const sites: RichTextSite[] = [];
  for (const absolute of walkFiles(root, isSourceFile)) {
    sites.push(...richTextSitesIn(readText(absolute), toRelative(repoRoot, absolute)));
  }
  return { available: true, sites };
}
