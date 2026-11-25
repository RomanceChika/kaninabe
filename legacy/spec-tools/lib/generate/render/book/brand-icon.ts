/**
 * ハンドブック(README の題字 / design の章)へ埋め込むロゴの `<img>` の組み立て。
 *
 * ロゴの実物は `docs/book/assets/brand-icon.svg`(`book-assets.ts` が実装 `icon.svg` から
 * 書き出す写し)であり、ここは design_token_spec の `brand` からその `<img>` の事実を返すだけである
 * (生成器は I/O をしない規約)。
 */

import type { DesignTokenSpec } from '../../../model/design/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { BRAND_ICON_FILE } from './book-assets.js';

/** ロゴの画像(`src` は章のファイルからの相対)と、仮のアイコンの印の有無。 */
export interface BrandIconFact {
  readonly src: string;
  readonly provisional: boolean;
}

/**
 * ロゴの画像の事実。
 *
 * @param spec デザイントークン仕様(design_token_spec が無い環境では undefined / null)
 * @param ctx 生成文脈(`ctx.book.brandIconSvg` に実装からの写しが載っていれば embed できる)
 * @returns `brand` が無い / ロゴを埋め込めない(SVG 以外・未生成)なら null
 */
export function brandIconFact(spec: DesignTokenSpec | null | undefined, ctx: GenerateContext): BrandIconFact | null {
  const brand = spec?.brand;
  if (brand === null || brand === undefined || brand.icon === null) return null;
  const provisional = brand.placeholder !== null;
  if (brand.icon.endsWith('.svg')) {
    const svg = ctx.book?.brandIconSvg;
    if (svg === undefined) return null;
    return { src: `./${BRAND_ICON_FILE}`, provisional };
  }
  // PNG 等は生成の文字列経路に載らないので、手で置いた写し(G8 が実装と同じハッシュかを見る)を指す
  const ext = brand.icon.slice(brand.icon.lastIndexOf('.'));
  return { src: `./assets/brand-icon${ext}`, provisional };
}
