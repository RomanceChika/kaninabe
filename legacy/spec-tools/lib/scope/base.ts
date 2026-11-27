/**
 * 基準(base)の `product.md` から、実装の範囲の宣言だけを読む(P14 の比べる相手)。
 *
 * 読めない file・壊れた YAML・壊れた `implemented` は、**読み飛ばさず**「読めない」として返す(比べられないまま通さない)。
 * base にキーが無いのは正当な形(`{ declared: false }`)で、読めないのとは別である。
 */

import { tryReadText } from '../io/read-text.js';
import { SpecReporter } from '../model/parse-common.js';
import { parseProductImplemented, type ProductImplemented } from '../model/product/implemented.js';
import { parseSafeFrontmatter } from '../model/safe-frontmatter.js';

/** 基準の宣言を読んだ結果。 */
export type BaseScope =
  | { readonly state: 'read'; readonly scope: ProductImplemented }
  | { readonly state: 'unreadable'; readonly reason: string };

/**
 * 基準の `product.md` を読む。
 *
 * @param file 基準の `product.md` のパス
 */
export function readBaseScope(file: string): BaseScope {
  const source = tryReadText(file);
  if (source === null) return { state: 'unreadable', reason: '読み込めません(file が無い・読めない・file でない)' };
  const reporter = new SpecReporter(file);
  const data = parseSafeFrontmatter(source, reporter);
  if (data === null) return { state: 'unreadable', reason: firstMessage(reporter, 'frontmatter を読めません') };
  const scope = parseProductImplemented(data, reporter);
  if (reporter.findings().length > 0) return { state: 'unreadable', reason: firstMessage(reporter, 'implemented を読めません') };
  return { state: 'read', scope };
}

/** 最初の指摘の文(無ければ既定)。 */
function firstMessage(reporter: SpecReporter, fallback: string): string {
  return reporter.findings()[0]?.message ?? fallback;
}
