/**
 * 「書き方の例」章(examples-page-catalog*.ts)が使うデータ形と、指定を組み立てる小さなヘルパ。
 * ヘルパを各カタログファイルに再実装すると綴りの正が増えるので、ここに 1 つだけ置く。
 */

import { specPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/**
 * 抜粋の取り方。`code` は実コードの印、`spec` は仕様 md の見出しアンカー、
 * `sign` は見出しを持たない標識(生成ブロック外の手書き段落。`prose.ts` の `collectSigns`)を
 * 含む部分文字列で引く(chapters.ts の signpostQuotes と同じ母集合)。
 */
export type ExcerptSpec =
  | { readonly kind: 'code'; readonly file: string; readonly region: string; readonly lang: 'ts' | 'sql' }
  | { readonly kind: 'spec'; readonly file: string; readonly heading: string }
  | { readonly kind: 'sign'; readonly file: string; readonly includes: string };

/** 1 つの抜粋(ラベル + 前振りの文 + 抜粋の指定)。excerpt を省くと `note` だけの段落になる。 */
export interface ExampleStep {
  readonly label: string;
  readonly bridge?: string;
  readonly excerpt?: ExcerptSpec;
  readonly note?: string;
}

/** 1 つの実例(見出し + 導入 + 抜粋の並び)。 */
export interface ExampleEntry {
  readonly title: string;
  readonly intro: string;
  readonly steps: readonly ExampleStep[];
}

/** 1 つのカテゴリ(索引の 1 行 + 実例の並び)。 */
export interface ExampleCategory {
  readonly title: string;
  readonly intro: string;
  readonly examples: readonly ExampleEntry[];
}

/** 実コードの印(`// #region example:{region}` 等)を指す。 */
export function code(file: string, region: string, lang: 'ts' | 'sql'): ExcerptSpec {
  return { kind: 'code', file, region, lang };
}

/** 仕様 md の見出しアンカーを指す(仕様の木からの相対パスを渡す)。 */
export function spec(roots: ProductRoots, specRelativePath: string, heading: string): ExcerptSpec {
  return { kind: 'spec', file: specPath(roots, specRelativePath), heading };
}

/** 仕様 md の標識(見出しを持たない手書き段落)を、含む文字列で指す。 */
export function sign(roots: ProductRoots, specRelativePath: string, includes: string): ExcerptSpec {
  return { kind: 'sign', file: specPath(roots, specRelativePath), includes };
}
