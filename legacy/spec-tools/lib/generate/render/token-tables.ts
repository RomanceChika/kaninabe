/**
 * デザイントークン仕様(tokens.md)の `token-tables` マーカーに、トークンの可読形を
 * 生成するジェネレーター。
 *
 * フロントマターの palette / groups / contrast を表に写すだけで、情報を足さない。
 * ref の解決値(hex)と contrast の実比は、宣言済みの値から機械的に計算できる導出であり
 * (検査 G3 と同じ計算)、新しい判断は含まない。
 */

import type { SpecModel } from '../../model/types.js';
import type { DesignTokenSpec } from '../../model/design/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { contrastRatio } from '../../model/design/color.js';
import { cell, EMPTY_CELL, markdownTable } from '../../gen-kit/state-machine-table.js';

/**
 * トークン仕様の本文ブロックを生成するジェネレーター。
 * 出力は tokens.md の `token-tables` マーカー 1 か所。
 */
export const tokenTablesGenerator: DocGenerator = {
  id: 'token-tables',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const design = ctx.design;
    if (design === undefined || !design.available || design.spec === null) return [];
    const spec = design.spec;
    return [{ file: spec.file, marker: 'token-tables', content: renderTokenTables(spec) }];
  },
};

/** 表の描き分けオプション。 */
export interface TokenTableOptions {
  /**
   * 色トークンの行に実際の色スウォッチ(CSS 変数を引く span)を添える。
   *
   * ハンドブックのデザインの章だけが使う — テーマが読み込む生成 CSS
   * (docs/book/assets/tokens.css)の `--{トークン名}` を引くため、値の写しではなく
   * **その場のトークンの実値**が塗られる。仕様ファイル(tokens.md)側は従来どおり
   * 値の文字列だけを出す。
   */
  readonly swatches?: boolean;
}

/**
 * トークン一覧とコントラスト検査の表を組み立てる。
 *
 * @param spec 読み込み済みのトークン仕様
 * @param options 表の描き分け(省略時はスウォッチ無し)
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderTokenTables(spec: DesignTokenSpec, options: TokenTableOptions = {}): string {
  return [
    `### ${TOKEN_LIST_HEADING}`,
    '',
    tokenTable(spec, options),
    '',
    `### ${CONTRAST_HEADING}`,
    '',
    contrastTable(spec),
  ].join('\n');
}

/** トークン一覧の見出し行。 */
export const TOKEN_HEADERS = ['トークン', 'グループ', '値（ref の解決後）', 'ref（palette）', '用途'] as const;

/** コントラスト検査の見出し行。 */
export const CONTRAST_HEADERS = ['前景（fg）', '背景（bg）', '要求比', '実比'] as const;

/** トークン一覧・コントラスト検査の小見出し。 */
export const TOKEN_LIST_HEADING = 'トークン一覧';
export const CONTRAST_HEADING = 'コントラスト検査（contrast）';

/** トークン 1 つの事実(グループ順・宣言順)。 */
export interface TokenFact {
  readonly name: string;
  readonly group: string;
  readonly value: string;
  readonly ref: string | null;
  readonly note: string;
}

/** 全トークンの事実(グループ順・宣言順)。 */
export function tokenFacts(spec: DesignTokenSpec): TokenFact[] {
  return spec.groups.flatMap((group) =>
    group.tokens.map((token) => ({ name: token.name, group: group.group, value: token.value, ref: token.ref, note: token.note ?? '' })),
  );
}

/** コントラスト宣言 1 組の事実(実比は解決値からの機械計算。計算できなければ null)。 */
export interface ContrastFact {
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
  readonly actual: string | null;
}

/** contrast 宣言の事実(要求比と、解決値から計算した実比)。 */
export function contrastFacts(spec: DesignTokenSpec): ContrastFact[] {
  const values = new Map(spec.tokens.map((token) => [token.name, token.value]));
  return spec.contrast.map((pair) => {
    const ratio = contrastRatio(values.get(pair.fg) ?? '', values.get(pair.bg) ?? '');
    return { fg: pair.fg, bg: pair.bg, min: pair.min, actual: ratio === null ? null : `${(Math.round(ratio * 100) / 100).toFixed(2)}:1` };
  });
}

/** 全トークンの表(グループ順・宣言順。ref があれば palette 名と解決値の両方を出す)。 */
function tokenTable(spec: DesignTokenSpec, options: TokenTableOptions): string {
  const rows = tokenFacts(spec).map((token) => [
    `\`--${token.name}\``,
    cell(token.group),
    valueCell(token.value, token.group === 'color' && options.swatches === true ? token.name : null),
    token.ref === null ? EMPTY_CELL : cell(token.ref),
    cell(token.note),
  ]);
  return markdownTable([...TOKEN_HEADERS], rows);
}

/** 値のセル(スウォッチつきなら、値の前に色見本の span を置く)。 */
function valueCell(value: string, swatchToken: string | null): string {
  if (swatchToken === null) return cell(value);
  return `<span class="token-swatch" style="--swatch: var(--${swatchToken});"></span> ${cell(value)}`;
}

/** contrast 宣言の表(要求比と、解決値から計算した実比)。 */
function contrastTable(spec: DesignTokenSpec): string {
  const rows = contrastFacts(spec).map((pair) => [cell(pair.fg), cell(pair.bg), `${pair.min}:1`, pair.actual === null ? EMPTY_CELL : pair.actual]);
  return markdownTable([...CONTRAST_HEADERS], rows);
}
