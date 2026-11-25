/**
 * 「書き方の例」章の**実装・テストの抜粋元**の置き場を、置き場の配置から引く口(部品化 ③-c5)。
 *
 * 抜粋元は**そのリポジトリの実ファイル**で、どのファイルのどこを見せるか(ファイル名の末尾)は例の表(`examples-page-catalog*.ts`)の編集方針である。
 * 層・土台の位置(操作の本体の層・基盤の層・テスト支援の土台)だけを配置が決める —— 役割 `operation-logic` / `infrastructure` と、配置が宣言する土台の表。
 * **製品固有の末尾(ファイル名)は役割にせず、例の表に残す**(製品の抜粋元の宣言であって、置き場の役割ではない)。
 *
 * 解決できなければ空文字(抜粋元が空文字・実在しない抜粋元は、どちらも章の生成が鮮度エラーとして名指す —— `readRepoFile` は空文字やディレクトリを null にし、
 * 章の組み立てが「抜粋元の置き場を置き場の配置から決められない」として報告する。読めなかったら赤くなる読み取りは空に倒してよい)。
 */

import { layoutBaseDirPath } from '../../../model/framework-base-dirs.js';
import { layoutPath, layoutScan } from '../../../model/product/layout.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 基盤の層のテスト支援の土台(統合テスト・実 DB との突合。層の名前と、層の直下からの土台のパス)。 */
export const INFRA_TESTS = { layer: 'infrastructure', dir: '__tests__' } as const;

/**
 * 手書きの操作の本体のファイル(役割 `operation-logic`)。
 *
 * @param layout 置き場の配置
 * @param roots 製品の根
 * @param operationId 操作 ID(`{集約}.{イベント}`)
 * @returns リポジトリルート相対のパス。決められなければ空文字
 */
export function operationSource(layout: ProductLayout, roots: ProductRoots, operationId: string): string {
  return layoutPath(layout, roots.app, 'operation-logic', operationId) ?? '';
}

/**
 * 基盤の層(役割 `infrastructure`。集約のクエリの写像・外部連携のアダプタ)の下のファイル。
 *
 * 集約のディレクトリ名(`name`)を単独の文字列として渡さない —— 仕様の語と一致する文字列は仕組み側のコードに置けない(W1)ので、末尾は `{集約}/queries.ts` の形で渡す。
 *
 * @param layout 置き場の配置
 * @param roots 製品の根
 * @param tail 基盤の層の下の相対パス(製品の抜粋元。例: `{集約}/queries.ts`)
 * @returns リポジトリルート相対のパス。決められなければ空文字
 */
export function infrastructureSource(layout: ProductLayout, roots: ProductRoots, tail: string): string {
  const scan = layoutScan(layout, roots.app, 'infrastructure');
  return scan === null ? '' : `${scan.dir}/${tail}`;
}

/**
 * 層の土台ディレクトリ(置き場の配置が宣言する土台の表の 1 行)の下のファイル。
 *
 * @param layout 置き場の配置
 * @param roots 製品の根
 * @param base 層の名前と、層の直下からの土台のパス
 * @param tail 土台の下の相対パス(製品の抜粋元)
 * @returns リポジトリルート相対のパス。決められなければ空文字
 */
export function baseDirSource(layout: ProductLayout, roots: ProductRoots, base: { readonly layer: string; readonly dir: string }, tail: string): string {
  const dir = layoutBaseDirPath(layout, roots.app, base.layer, base.dir);
  return dir === null ? '' : `${dir}/${tail}`;
}
