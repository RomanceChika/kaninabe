/**
 * 単発の操作から導く **app 側の名前**(ファイル・export)の唯一の置き場。
 *
 * Server Action / composition の生成器と、閉世界の期待(`code-structure-expectations.ts`)が
 * 同じ名前を組み立てるため、規約をここ 1 か所に置く。綴りの正が 2 つになると、生成物と期待が
 * すれ違ったときにどちらが正か決まらなくなる(保存点側の `usecase-app-names.ts` と同じ理由)。
 *
 * 操作 ID は `{集約}.{イベント}` であり、名前はその 2 語だけから決まる ——
 * ここに操作ごとの分岐は 1 つも無い(アプリの語彙を持たない。W1)。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { appPlacedModule, appPlacedPath } from './app-placement.js';
import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';

/** 操作 ID を 2 語(集約・イベント)に割る。 */
export function splitOperation(op: string): { readonly aggregate: string; readonly event: string } {
  const [aggregate, event] = op.split('.');
  return { aggregate: aggregate ?? '', event: event ?? '' };
}

/**
 * Server Action のファイル(リポジトリルートからの相対。役割 `operation-entry`)。置き場を決められなければ前提の失敗で止める(`app-placement.ts`)。
 *
 * @param op 操作 ID(`{集約}.{イベント}`)
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。実装の木を持たない製品は呼び手が先に返す)
 * @param location 仕様の位置(置き場を決められないときに指す)
 */
export function actionFileOf(op: string, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  return appPlacedPath(layout, roots, { role: 'operation-entry', key: op, what: `操作 ${op} の Server Action`, location });
}

/** Composition Root のファイル(リポジトリルートからの相対。役割 `operation-composition`)。決められなければ前提の失敗で止める。 */
export function compositionFileOf(op: string, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, location: SourceLocation): string {
  return appPlacedPath(layout, roots, { role: 'operation-composition', key: op, what: `操作 ${op} の Composition Root`, location });
}

/** Composition Root のモジュール指定子(役割 `operation-composition` の import の指定。拡張子なし)。決められなければ前提の失敗で止める。 */
export function compositionModuleOf(op: string, layout: ProductLayout, location: SourceLocation): string {
  return appPlacedModule(layout, { role: 'operation-composition', key: op, what: `操作 ${op} の Composition Root`, location });
}

/** Server Action の export 名(`{camel(イベント)}{Pascal(集約)}Action`)。 */
export function actionExportOf(op: string): string {
  const { aggregate, event } = splitOperation(op);
  return `${toCamelCase(event)}${toPascalCase(aggregate)}Action`;
}

/** 記録に載せる操作の関数名(`{camel(イベント)}{Pascal(集約)}`。Server Action の export 名から `Action` を除いたもの)。 */
export function operationNameOf(op: string): string {
  const { aggregate, event } = splitOperation(op);
  return `${toCamelCase(event)}${toPascalCase(aggregate)}`;
}

/** Composition Root のファクトリ名(`create{Pascal(イベント)}{Pascal(集約)}`)。 */
export function factoryExportOf(op: string): string {
  const { aggregate, event } = splitOperation(op);
  return `create${toPascalCase(event)}${toPascalCase(aggregate)}`;
}

/** 入力の型名(`{Pascal(イベント)}{Pascal(集約)}Input`)。 */
export function inputTypeOf(op: string): string {
  const { aggregate, event } = splitOperation(op);
  return `${toPascalCase(event)}${toPascalCase(aggregate)}Input`;
}
