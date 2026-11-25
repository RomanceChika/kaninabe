/**
 * 操作・保存点の入口(Server Action)・組み立ての根・フォームの置き場を、置き場の配置から引く口(`code-operation-app` / `code-usecase-app` / `code-usecase-form` が共有する)。
 *
 * 置き場は文脈の配置(アプリの枠の後段が与える `ProductLayout`)の役割が決める。**実装の木を持たない製品は置き場が無いことが事実**なので、呼び手が先に何も出さずに返す。
 * 実装の木があるのに配置が決められなければ、黙って 0 本にせず前提の失敗で止める(`layout-placement.ts`)。名指すのは配置の定義の検査
 * (`LAYOUT_DEFINITION_CHECK`): これらの役割を配置から読む検査の群は、いまは無い(読む側の `trace/scan.ts` ・A2 ・構造の期待は旧い綴りのまま。配置から引くのは ③-c4b)。
 * 検査の群の ID を借りて指すと、実際に止める所を取り違える。
 *
 * 綴り(`{集約}/{イベント}`・`usecase/{名}/{保存点}`)は配置の値が持つ。ここが持つのは**役割とキーの組み立て**だけ(操作 ID・保存点 ID は 2 語の鍵)。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { LayoutRole, ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { LAYOUT_DEFINITION_CHECK, placedModule, placedPath } from '../layout-placement.js';

/** この口が引く役割(`layout.ts` の語彙のうち、操作・保存点の入口と組み立ての根とフォームの分)。 */
export type AppPlacementRole = 'operation-entry' | 'operation-composition' | 'save-entry' | 'save-composition' | 'ui-component' | 'platform-op-entry' | 'platform-op-composition' | 'platform-op-test';

/** 置き場を決めたい 1 件(役割・キー・人が読む出どころ・仕様の位置)。 */
export interface AppPlacement {
  /** 取りたい役割。 */
  readonly role: AppPlacementRole;
  /** キー(操作 ID・保存点 ID・フォームのファイル名)。 */
  readonly key: string;
  /** 人が読む出どころ(例: `操作 widget.send の Server Action`)。 */
  readonly what: string;
  /** 出どころの仕様の位置(置き場そのものは仕様に書かれないので、その元の仕様)。 */
  readonly location: SourceLocation;
}

/** 前提の失敗に載せる形に直す(名指す検査は配置の定義の検査)。 */
function placement(spec: AppPlacement): { readonly role: LayoutRole; readonly key: string; readonly what: string; readonly location: SourceLocation; readonly verifier: string } {
  return { ...spec, verifier: LAYOUT_DEFINITION_CHECK };
}

/**
 * 役割 + キー → パス(リポジトリルート相対)。決められなければ前提の失敗で止める。
 *
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。null なら置き場が無いので、呼び手が先に返しておく)
 * @param spec 置き場を決めたい 1 件
 * @returns パス
 */
export function appPlacedPath(layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, spec: AppPlacement): string {
  return placedPath(layout, roots, placement(spec));
}

/**
 * 役割 + キー → import に使うモジュール指定(組み立ての根だけが持つ)。決められなければ前提の失敗で止める。
 *
 * @param layout 生成の文脈の配置
 * @param spec 置き場を決めたい 1 件
 * @returns モジュール指定
 */
export function appPlacedModule(layout: ProductLayout, spec: AppPlacement): string {
  return placedModule(layout, placement(spec));
}
