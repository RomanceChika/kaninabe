/**
 * 製品の根の宣言(`product.md`)を読む I/O 境界。
 *
 * 宣言は 1 製品 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (config / notification / job のカタログと同じ形)。YAML → モデルの変換は parse-product の
 * 純粋関数に委ね、ここは読めない環境で壊れないことだけを担保する。
 *
 * **このローダーがリポジトリの中で一番早く走る。** 他のローダーは走査ルートを受け取るが、
 * 走査ルートそのものがこの宣言から出るためである。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { isFile, PRODUCT_DECL_FILE } from '../../io/paths.js';
import { parseProductImplemented, type ProductImplemented } from './implemented.js';
import { parseProductRoots, parseProductUses } from './parse-product.js';
import type { ProductRootsModel } from './types.js';
import type { ProductUses } from './uses.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは P0(スキーマ適合)のみ。 */
export const P0_VERIFIER_ID = 'P0';

/** loadProductRoots の結果。 */
export interface LoadProductRootsResult {
  /** 構築したモデル。宣言ファイルが無い場合は `available: false`。 */
  readonly model: ProductRootsModel;
  /**
   * 製品が採ると宣言した仕様の種類(`uses`)。**根と同じ宣言の欠かせない一部**なので、
   * 宣言が無い・根か `uses` のどちらかが読めなかったときは null(根も null になる)。
   */
  readonly uses: ProductUses | null;
  /**
   * 製品が宣言した実装の範囲(`implemented`)。キーが無い・値が壊れている・宣言が読めないときは `{ declared: false }`(全部が範囲)。
   * 根と `uses` の読み取りとは独立で、壊れていても根と `uses` は読めたまま返る。
   */
  readonly implemented: ProductImplemented;
  /** 構築中に検出した P0 違反。 */
  readonly findings: readonly Finding[];
}

/**
 * 製品の根の宣言を読む。
 *
 * 宣言が無い場合は `available: false` を返して壊れない —— 「宣言が要る」と言うのは P1 の仕事で
 * あり、ローダーが文言を持つと同じ事実に 2 つの検査が並ぶ。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @returns モデルと P0 違反のリスト
 */
export function loadProductRoots(repoRoot: string): LoadProductRootsResult {
  const file = path.join(repoRoot, PRODUCT_DECL_FILE);
  if (!isFile(file)) return { model: { available: false, roots: null }, uses: null, implemented: { declared: false }, findings: [] };

  const reporter = new SpecReporter(PRODUCT_DECL_FILE);
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  const parsedRoots = data === null ? null : parseProductRoots(data, reporter);
  const parsedUses = data === null ? null : parseProductUses(data, reporter);
  // **根と採用の宣言は 1 組で読む。** `uses` に既定値を置かない(推定しない)ので、どちらかが読めない宣言は
  // 「何も採っていない」ではなく「宣言が読めない」である。根だけ生かすと、採用が不明のまま検査が走る。
  const parsedImplemented: ProductImplemented = data === null ? { declared: false } : parseProductImplemented(data, reporter);
  const complete = parsedRoots !== null && parsedUses !== null;
  return {
    model: { available: true, roots: complete ? parsedRoots : null },
    uses: complete ? parsedUses : null,
    // 根か `uses` が読めない宣言は「宣言が読めない」で、範囲も宣言なし(全部)に戻す(読めた一部だけで検査を外さない)。
    implemented: complete ? parsedImplemented : { declared: false },
    findings: reporter.findings().map(rebrand),
  };
}

/** ファイルを読む。読めない場合は違反を記録して null。 */
function readText(absolute: string, reporter: SpecReporter): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch (cause) {
    reporter.error(
      undefined,
      `宣言ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
      'ファイルの権限とパスを確認する',
    );
    return null;
  }
}

/** SpecReporter は V1 固定で積むため、宣言側のスキーマ違反であることが分かるよう P0 に付け替える。 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: P0_VERIFIER_ID };
}
