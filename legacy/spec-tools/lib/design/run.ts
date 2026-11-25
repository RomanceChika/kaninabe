/**
 * 視覚層の検証(G0 + G1〜G3)の実行口。
 *
 * CLI とパイプラインはこの 1 関数だけを呼べばよく、検証器が増えてもどちらも変わらない
 * (規約: scripts-code-quality.md)。実行状況の 1 行報告(`summary`)をここで組み立てるのは、
 * パイプライン側に「G 群が何件見たか」という知識を置かないためである。
 */

import type { Finding } from '../kernel/finding.js';
import { loadAppCss, loadBookFaceCss, loadBrandFiles, loadDesignTokens } from '../model/design/loader.js';
import type { DesignTokenSpec } from '../model/design/types.js';
import { ALL_DESIGN_VERIFIERS } from './verifiers/index.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** runDesignVerification の入力。 */
export interface DesignRunOptions {
  /** `docs/specs/frontend/design` の絶対パス。 */
  readonly designRoot: string;
  /** `app` の絶対パス。ここが無ければ G1・G2 は実行しない。 */
  readonly appRoot: string;
  /** Finding の location.file の基準。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(ロゴの置き場・既定の残骸の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(既定のアイコンの残骸の位置。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/** runDesignVerification の結果。 */
export interface DesignRunResult {
  /** 全 Finding(G0 → G1 → G2 → G3 の順)。 */
  readonly findings: readonly Finding[];
  /** トークン仕様を読めたか。false なら G1〜G3 は実行していない。 */
  readonly available: boolean;
  /** 実行状況の 1 行報告(CLI がそのまま出す)。 */
  readonly summary: string;
  /**
   * 実装の木があるのに、置き場の配置にアプリの既定のアイコンの役割(`app-icon`)が無い(G8 の「既定の残骸が残っていない」を見られない)。
   * 黙って緑にせず、呼び手(配線)が「未実施」と名指す。
   */
  readonly defaultIconUnplaced: boolean;
}

/**
 * 視覚層の検証を実行する。
 *
 * @param options 走査の起点
 * @returns 全 Finding と実行状況
 */
export function runDesignVerification(options: DesignRunOptions): DesignRunResult {
  const { model, findings: loadFindings } = loadDesignTokens(options.designRoot, {
    repoRoot: options.repoRoot,
  });
  if (!model.available) {
    return {
      findings: [],
      available: false,
      summary: 'G 群(視覚層): specs/frontend/design が無いためスキップしました。',
      defaultIconUnplaced: false,
    };
  }

  const appCss = loadAppCss(options.appRoot, options.roots, options.layout, { repoRoot: options.repoRoot });
  // ブックの人向けの表示の CSS も同じ規約で見る(実装の木が無い環境では G1・G2・G7 ごと飛ばす)。
  const css = appCss.available
    ? { ...appCss, files: [...appCss.files, ...loadBookFaceCss(options.repoRoot)] }
    : appCss;
  const brand = loadBrandFiles(options.repoRoot, options.roots, options.layout, model.spec?.brand ?? null);
  const input = { tokens: model, css, brand, roots: options.roots };
  const findings: Finding[] = [...loadFindings];
  for (const verifier of ALL_DESIGN_VERIFIERS) findings.push(...verifier.verify(input));

  return {
    findings,
    available: true,
    summary: summarize(model.spec, css.files.length, css.available, brand.appGrounded),
    defaultIconUnplaced: options.roots.app !== null && brand.faviconIcoPath === null,
  };
}

/** 実行状況の 1 行を組み立てる。 */
function summarize(
  spec: DesignTokenSpec | null,
  cssCount: number,
  cssAvailable: boolean,
  appGrounded: boolean,
): string {
  if (spec === null) return 'G 群(視覚層): トークン仕様を読めなかったため G1〜G3・G7・G8 はスキップしました(G0 の指摘を参照)。';
  const brandScope = appGrounded ? '' : '・G8 はロゴの実在の突合をスキップ';
  const scope =
    (cssAvailable ? 'G1〜G3・G7・G8' : 'G3・G8 のみ(app/src が無いため G1・G2・G7 はスキップ)') + brandScope;
  const placeholderCount = spec.brand?.placeholder === null || spec.brand === null ? 0 : 1;
  return (
    `G 群(視覚層): トークン ${spec.tokens.length} 件 / コントラスト宣言 ${spec.contrast.length} 件 / ` +
    `CSS ${cssCount} ファイルに対し ${scope} を実行しました(brand: placeholder ${placeholderCount} 件)。`
  );
}
