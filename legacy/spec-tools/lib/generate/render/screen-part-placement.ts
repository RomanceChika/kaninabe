/**
 * 画面の部品の生成物(`screen-part`)の置き場を、置き場の配置から引く口(部品を書く 3 つの生成器と、期待の木が共有する)。
 *
 * 置き場は文脈の配置(アプリの枠の後段が与える `ProductLayout`)の役割 `screen-part` が決める。**実装の木を持たない製品は置き場が無いことが事実**なので
 * 何も出さない(null)。実装の木があるのに配置が決められなければ、黙って 0 本にせず前提の失敗で止める(`layout-placement.ts`。名指す検査は S7)。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import { specPath } from '../../model/product/paths.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { LAYOUT_DEFINITION_CHECK, placedPath } from '../layout-placement.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';

/** 画面の部品の生成物 1 本の出どころ(違反の説明に出る)。 */
export interface ScreenPartOrigin {
  /** 人が読む出どころ(例: `画面 workshop_detail の部品 venue_form`)。 */
  readonly what: string;
  /** 出どころの仕様の位置。 */
  readonly location: SourceLocation;
}

/**
 * 画面の部品の生成物のパス(リポジトリルート相対)。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @param file ファイル名(`{画面名}.{部品名}.tsx` ・既定のスタイル・競合の表示の部品)
 * @param origin 出どころ(置き場を決められないときの説明)
 * @returns パス。実装の木を持たない製品は null
 */
export function screenPartFile(ctx: GenerateContext, file: string, origin: ScreenPartOrigin): string | null {
  if (ctx.roots.app === null) return null;
  return placedPath(ctx.layout, ctx.roots, { role: 'screen-part', key: file, what: origin.what, location: origin.location, verifier: LAYOUT_DEFINITION_CHECK });
}

/**
 * 画面の部品の生成物の**実装の木の中の相対パス**(期待ファイル木が持つ形。閉世界の検査が木の根を別に知っている)。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @param file ファイル名
 * @param origin 出どころ(置き場を決められないときの説明)
 * @returns 製品の根からの相対パス。実装の木を持たない製品は null
 */
export function screenPartExpectedFile(ctx: GenerateContext, file: string, origin: ScreenPartOrigin): string | null {
  if (ctx.roots.app === null) return null;
  return placedPath(ctx.layout, { app: '' }, { role: 'screen-part', key: file, what: origin.what, location: origin.location, verifier: LAYOUT_DEFINITION_CHECK });
}

/**
 * 画面の部品 1 本の出どころ(違反の説明に出る位置は、その画面の仕様の位置)。**画面が仕様に無い計画は前提の失敗**で止める —— 画面名をファイル扱いの位置に
 * 黙って置き換えない(部品の計画は画面の仕様から作るので、無ければ計画と仕様が食い違っている)。
 *
 * @param ctx 生成の文脈(`roots` を読む。画面が無いときの位置は仕様の木の画面の置き場)
 * @param screens 画面名 → 画面(部品の計画の元)
 * @param plan 部品の計画のうち、画面名
 * @param what 人が読む出どころの種別(例: `フォーム`)
 * @param verifier 計画を作る側の検査の ID(画面の部品の計画が仕様と食い違うときに先に見る検査)
 * @returns 出どころ
 */
export function screenPartOriginOf(
  ctx: GenerateContext,
  screens: ReadonlyMap<string, { readonly location: SourceLocation }>,
  plan: { readonly screen: string; readonly file: string },
  what: string,
  verifier: string,
): ScreenPartOrigin {
  const screen = screens.get(plan.screen);
  if (screen === undefined) {
    return preconditionFailure(verifier, [
      {
        message: `画面 ${plan.screen} の${what} ${plan.file} の計画があるのに、その画面の仕様が読み込まれた画面に無く、出どころの位置を決められません`,
        suggestion: `${verifier} が、部品の計画の元の画面が仕様にあることを先に確かめる`,
        counterexample: { screen: plan.screen, file: plan.file },
        location: { file: specPath(ctx.roots, 'frontend/screens') },
      },
    ]);
  }
  return { what: `画面 ${plan.screen} の${what} ${plan.file}`, location: screen.location };
}
