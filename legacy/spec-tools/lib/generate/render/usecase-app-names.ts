/**
 * 保存点から導く **app 側の名前**(ファイル・export)の唯一の置き場。
 *
 * Server Action / composition / 1 画面フォームの生成器と、閉世界の期待
 * (`code-structure-expectations.ts`)が同じ名前を組み立てるため、規約をここ 1 か所に置く。
 * 綴りの正が 2 つになると、生成物と期待がすれ違ったときにどちらが正か決まらなくなる。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import { CORE_REQUIRED_BASE_DIRS } from '../../model/framework-dirs.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { BuiltSave } from '../../usecase/plan-build.js';
import { formFileNameFor, saveIdFor } from '../../usecase/save-names.js';
import { LAYOUT_DEFINITION_CHECK, placedBaseDir, placedModule, placedPath } from '../layout-placement.js';
import { appPlacedModule, appPlacedPath } from './app-placement.js';
import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';

/** 保存点の鍵(`{ユースケース名}.{保存点 ID}`。置き場の配置の保存点 ID の形)。 */
export function saveKeyOf(save: BuiltSave): string {
  return saveIdFor(save.usecase.name, save.plan.save.id);
}

/**
 * 保存点の Server Action のファイル(リポジトリルートからの相対。役割 `save-entry`)。置き場を決められなければ前提の失敗で止める(`app-placement.ts`)。
 *
 * @param save 保存点
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。実装の木を持たない製品は呼び手が先に返す)
 * @param location 仕様の位置(置き場を決められないときに指す)
 */
export function saveActionFileOf(save: BuiltSave, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  const key = saveKeyOf(save);
  return appPlacedPath(layout, roots, { role: 'save-entry', key, what: `保存点 ${key} の Server Action`, location });
}

/** 保存点の Composition Root のファイル(リポジトリルートからの相対。役割 `save-composition`)。決められなければ前提の失敗で止める。 */
export function saveCompositionFileOf(save: BuiltSave, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  const key = saveKeyOf(save);
  return appPlacedPath(layout, roots, { role: 'save-composition', key, what: `保存点 ${key} の Composition Root`, location });
}

/** 保存点の Composition Root のモジュール指定子(役割 `save-composition` の import の指定。拡張子なし)。決められなければ前提の失敗で止める。 */
export function saveCompositionModuleOf(save: BuiltSave, layout: ProductLayout, location: SourceLocation): string {
  const key = saveKeyOf(save);
  return appPlacedModule(layout, { role: 'save-composition', key, what: `保存点 ${key} の Composition Root`, location });
}

/** 1 画面フォームのファイル名(役割 `ui-component` のキー。`{ユースケース名}.{保存点 ID}-form.tsx`)。 */
export function formFileNameOf(save: BuiltSave): string {
  return formFileNameFor(save.usecase.name, save.plan.save.id);
}

/** 1 画面フォームのファイル(リポジトリルートからの相対。役割 `ui-component`)。決められなければ前提の失敗で止める。 */
export function formFilePathOf(save: BuiltSave, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  const key = formFileNameOf(save);
  return appPlacedPath(layout, roots, { role: 'ui-component', key, what: `保存点 ${saveKeyOf(save)} の 1 画面フォーム`, location });
}

/** `{camel(ユースケース名)}{Pascal(保存点 ID)}`(スキーマ・Action の接頭辞)。 */
export function saveBase(save: BuiltSave): string {
  return `${toCamelCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}`;
}

/** `{Pascal(ユースケース名)}{Pascal(保存点 ID)}`(型名・ファクトリ名の後半)。 */
export function savePascal(save: BuiltSave): string {
  return `${toPascalCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}`;
}

/** 手書きの hooks の export 名。 */
export function hooksExportName(save: BuiltSave): string {
  return `${saveBase(save)}Hooks`;
}

/** 手書きの hooks の置き場(コアが前提にする土台。層と、層の直下からの相対パスは `CORE_REQUIRED_BASE_DIRS.hooks`)。 */
const HOOKS_BASE = CORE_REQUIRED_BASE_DIRS.hooks;

/**
 * 手書きの hooks のファイル(製品の根からの相対。置き場の配置が宣言する土台 `operation/usecase` の下)。決められなければ前提の失敗で止める。
 *
 * @param save 保存点
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。実装の木を持たない製品は呼び手が先に返す)
 * @param location 仕様の位置(置き場を決められないときに指す)
 */
export function hooksFilePathOf(save: BuiltSave, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  const dir = placedBaseDir(layout, roots, { layer: HOOKS_BASE.layer, dir: HOOKS_BASE.dir, what: `保存点 ${saveKeyOf(save)} の手書きの hooks`, location });
  return `${dir}/${save.usecase.name}/${save.plan.save.id}.ts`;
}

/**
 * 手書きの hooks の import の指定(拡張子なし。生成物の本文が `import` する。ソースの根の別名 + ソースの根からの相対)。
 * 置き場は `hooksFilePathOf` と同じ土台から引く(期待ファイルの置き場と import の指定が別々の綴りにならない)。決められなければ前提の失敗で止める。
 *
 * @param save 保存点
 * @param layout 生成の文脈の配置
 * @param location 仕様の位置(置き場を決められないときに指す)
 */
export function hooksModuleOf(save: BuiltSave, layout: ProductLayout, location: SourceLocation): string {
  const what = `保存点 ${saveKeyOf(save)} の手書きの hooks`;
  const home = { app: '' };
  const dir = placedBaseDir(layout, home, { layer: HOOKS_BASE.layer, dir: HOOKS_BASE.dir, what, location });
  const source = placedPath(layout, home, { role: 'source-root', what, location, verifier: LAYOUT_DEFINITION_CHECK });
  const alias = placedModule(layout, { role: 'source-root', what, location, verifier: LAYOUT_DEFINITION_CHECK });
  const inside = source === '' ? dir : dir.slice(source.length + 1);
  return `${alias}/${inside}/${save.usecase.name}/${save.plan.save.id}`;
}

/** 1 画面フォームの export 名。 */
export function formExportName(save: BuiltSave): string {
  return `${savePascal(save)}Form`;
}
