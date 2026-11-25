/**
 * 生成テストとハーネスのアダプタの**本文が辿る相対の import**の契約(`layoutBodyImportProblems`)。
 *
 * 生成テストの本文は、ハーネスのアダプタを**相対の指定**(`../../eq-world` など)で import する。この相対の指定は置き場の深さの写しで、
 * 置き場は配置の値(`ProductLayout`)が決めるので、配置がテストの置き場かアダプタの置き場の深さを変えると、本文の import が黙って食い違う
 * (生成物は書けるのに、書いたテストが import を解決できない)。本文を配置から組む(モジュール指定を役割に持たせる)のは P5 / P6 の仕事で、
 * ここは**食い違いを選ぶ根の 1 回で止める**ところまでを持つ: 「本文が辿る先」と「アダプタの役割の置き場」が一致することを、定義の検査が見る。
 *
 * 指定の綴りの正はここ(生成器 5 本がこの定数から本文を組む)で、表 `LAYOUT_BODY_IMPORTS` は同じ定数から作る — 本文の綴りと検査の綴りが別々に書かれて
 * 食い違わない。**見ない相手**: 操作の生成ユニットテストが辿る `__tests__/plan-harness` / `plan-property`(製品が手で書くテスト支援の土台の置き場で、配置の役割ではない)と、
 * アダプタが同じ役割の兄弟を `./…` で指す import(同じ役割は同じ置き場の根を持つので食い違えない)。
 */

import type { LayoutRole } from './layout.js';

/** 実 DB で実行する 3 種の生成テスト(`__tests__/generated/{種別}/` の下)から、ハーネスのアダプタの置き場の根(`__tests__/`)への相対。 */
export const TEST_TO_ADAPTER_DIR = '../..';

/** 保存点の一致の証明が使う配線の層のアダプタから、基盤の層のアダプタの置き場の根(`infrastructure/__tests__/`。層の名前はコアの語)への相対。 */
export const SAVE_ADAPTER_TO_BASE_ADAPTER_DIR = '../../infrastructure/__tests__';

/** 本文の相対 import 1 本の宣言。 */
export interface BodyImport {
  /** 本文を書く役割(相対の起点。置き場のディレクトリが起点になる)。 */
  readonly from: LayoutRole;
  /** 本文に書かれる相対の指定(拡張子なし)。 */
  readonly specifier: string;
  /** 辿り着くはずの役割。 */
  readonly to: LayoutRole;
  /** その役割のキー(アダプタ名)。 */
  readonly name: string;
  /**
   * 行き先が役割の実体ではなく、**その役割の置き場の根に並ぶ手書きのファイル**(口の実装 `harness-ports`)のとき true。置き場の綴り(拡張子・接尾辞)は
   * 配置が決めるので、行き先の置き場のディレクトリだけが一致すればよい(ファイル名は製品が決める)。
   */
  readonly sibling?: boolean;
}

/** 生成テストの 3 種 × ハーネスのアダプタ 2 本(world / expect)の宣言を作る。 */
function testImports(from: LayoutRole, to: LayoutRole, worldName: string, expectName: string): readonly BodyImport[] {
  return [worldName, expectName].map((name) => ({ from, specifier: `${TEST_TO_ADAPTER_DIR}/${name}`, to, name }));
}

/**
 * 本文の相対 import の全部(**これ以外は契約の外**)。
 * 保存点のアダプタが指す `harness-ports` は、製品が手で書く口の実装(基盤の層のアダプタと同じ置き場の根に居る)で、役割ではないが、
 * アダプタの置き場の根(`harness-adapter` の置き場)と一緒に動く宣言なので、同じ表で見る。
 */
export const LAYOUT_BODY_IMPORTS: readonly BodyImport[] = [
  ...testImports('eq-test', 'harness-adapter', 'eq-world', 'eq-expect'),
  ...testImports('rls-test', 'harness-adapter', 'rls-world', 'rls-expect'),
  ...testImports('eq-save-test', 'save-harness-adapter', 'eq-save-world', 'eq-save-expect'),
  { from: 'save-harness-adapter', specifier: `${SAVE_ADAPTER_TO_BASE_ADAPTER_DIR}/eq-world`, to: 'harness-adapter', name: 'eq-world' },
  { from: 'save-harness-adapter', specifier: `${SAVE_ADAPTER_TO_BASE_ADAPTER_DIR}/harness-ports`, to: 'harness-adapter', name: 'harness-ports', sibling: true },
];
