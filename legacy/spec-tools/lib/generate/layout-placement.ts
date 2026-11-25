/**
 * 生成器が**置き場の配置から役割の位置を引く**口(決められなければ前提の失敗で名指す)。
 *
 * 配置は生成の文脈の必須の欄(`GenerateContext.layout`)で、アプリの枠の後段が与える。配置が必要な役割(HTTP の入口・組み立ての根)を解決できないとき、
 * 生成器が**空の配列を黙って返す**と、「実装の木があるのに受信口が 1 本も生成されない」「認可の見張りが黙って縮む」が、検査も生成も緑のまま起きる。
 * そこで解決できなかった役割は、`preconditionFailure`(生成器は throw しない規約の唯一の出口)で、**先に見るべき検査**(HTTP の入口は J2 = 置き場と衝突の検査・
 * 画面の器は S7・**画面の部品の生成物のように、その役割を読む検査の群が無いものは配置の定義の検査 `LAYOUT_DEFINITION_CHECK`**。配置に無い役割・基準が辿れない配置は
 * `unknown_role` / `unresolvable` として名指す)を示して止める。
 *
 * 呼び手は先に「実装の木を持たない製品」を返す(`roots.app === null` は事実として置き場が無い。ここは**実装の木があるのに配置が決められない**時の口)。
 */

import { preconditionFailure } from '../kernel/generator-precondition.js';
import type { SourceLocation } from '../kernel/source-location.js';
import { layoutBaseDirPath } from '../model/framework-base-dirs.js';
import { layoutModule, layoutPath } from '../model/product/layout.js';
import type { LayoutRole, ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** 置き場を決めたい 1 件(役割とキーと、人が読む出どころ)。 */
export interface Placement {
  /** 取りたい役割。 */
  readonly role: LayoutRole;
  /** キー(URL のパス・連携 ID。キーを持たない役割は省略)。 */
  readonly key?: string;
  /** 人が読む出どころ(例: `ジョブ example_job の起動口 /api/x`)。 */
  readonly what: string;
  /** 出どころの仕様の位置。 */
  readonly location: SourceLocation;
  /** 前提の失敗が名指す、先に見るべき検査の ID(省略は `J2` = HTTP の入口の置き場と衝突の検査。画面の器は `S7`。その役割を読む検査の群が無いものは `LAYOUT_DEFINITION_CHECK`)。 */
  readonly verifier?: string;
}

/**
 * 名指す先が**どの検査の ID でもなく**、選ぶ根の 1 回の配置の定義の検査(`layoutDefinitionProblems`。役割ごとの下限・基準・キーの形)であることを表す名前。
 * 検査の群(S / J / A)がその役割を読まないのに、近いからと群の ID を名指すと、実際に止める所を取り違える(例: 画面の部品の生成物 `screen-part` は S7 が読まない)。
 */
export const LAYOUT_DEFINITION_CHECK = '配置の定義の検査';

/** 名指す検査ごとの、検査の呼び名(配置に無い役割・基準が辿れない配置を先に指す検査)。 */
const VERIFIER_LABELS: Readonly<Record<string, string>> = {
  S7: '画面の器の検査',
};

/** 名指す検査の 1 文(J2 は HTTP の入口の置き場の検査。それ以外は呼び名つき + 配置の定義の検査)。 */
function verifierNote(verifier: string): string {
  if (verifier === LAYOUT_DEFINITION_CHECK) {
    return `${LAYOUT_DEFINITION_CHECK}(\`layoutDefinitionProblems\`。役割ごとの下限・基準・キーの形。選ぶ根の 1 回)が、配置に無い役割・基準が辿れない配置を先に止める。`;
  }
  return verifier === 'J2'
    ? 'HTTP の入口の置き場の検査 J2 が、配置に無い役割・基準が辿れない配置を先に指す。'
    : `${VERIFIER_LABELS[verifier] ?? '検査'} ${verifier} と、配置の定義の検査(役割ごとの下限。選ぶ根の 1 回)が、配置に無い役割・基準が辿れない配置を先に指す。`;
}

/** 前提の失敗(置き場を決められない)。 */
function unplaced(layout: ProductLayout, placement: Placement, wanted: 'path' | 'module'): never {
  return preconditionFailure(placement.verifier ?? 'J2', [
    {
      message: `${placement.what} の${wanted === 'path' ? '置き場' : ' import の指定'}を、置き場の配置から決められません(役割 ${placement.role}${placement.key === undefined ? '' : `・キー ${placement.key}`})`,
      suggestion:
        'アプリの枠の後段の配置が、この役割を宣言し、基準の役割まで辿れてキーの形に合うようにする(' +
        verifierNote(placement.verifier ?? 'J2') +
        '実装の木を宣言する製品はアプリの枠の後段を選ぶ — 選択の契約が止める)',
      counterexample: { role: placement.role, key: placement.key ?? '', declared: layout[placement.role] === undefined ? 'no' : 'yes' },
      location: placement.location,
    },
  ]);
}

/**
 * 役割 + キー → パス(リポジトリルート相対。`roots.app` が `''` なら製品の根からの相対)。決められなければ前提の失敗で止める。
 *
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。null なら置き場が無いので、呼び手が先に返しておく)
 * @param placement 置き場を決めたい 1 件
 * @returns パス
 */
export function placedPath(layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, placement: Placement): string {
  return layoutPath(layout, roots.app, placement.role, placement.key) ?? unplaced(layout, placement, 'path');
}

/** 土台ディレクトリの置き場を決めたい 1 件(層の名前と、層の直下からの相対パスと、人が読む出どころ)。 */
export interface BaseDirPlacement {
  /** 層の名前(例: `operation`)。 */
  readonly layer: string;
  /** 層の直下からの相対パス(例: `usecase`)。 */
  readonly dir: string;
  /** 人が読む出どころ。 */
  readonly what: string;
  /** 出どころの仕様の位置。 */
  readonly location: SourceLocation;
}

/**
 * 土台ディレクトリ(置き場の配置が宣言する層と土台の表の 1 行)→ パス(リポジトリルート相対。`roots.app` が `''` なら製品の根からの相対)。
 * 決められなければ前提の失敗で止める(名指すのは配置の定義の検査 — 土台の表を読む検査の群は無い)。
 *
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る。null なら置き場が無いので、呼び手が先に返しておく)
 * @param placement 置き場を決めたい 1 件
 * @returns パス
 */
export function placedBaseDir(layout: ProductLayout, roots: Pick<ProductRoots, 'app'>, placement: BaseDirPlacement): string {
  const found = layoutBaseDirPath(layout, roots.app, placement.layer, placement.dir);
  if (found !== null) return found;
  return preconditionFailure(LAYOUT_DEFINITION_CHECK, [
    {
      message: `${placement.what} の置き場を、置き場の配置が宣言する土台の表から決められません(層 ${placement.layer}・土台 ${placement.dir})`,
      suggestion:
        'アプリの枠の後段の配置が、`source-root` の `structure.baseDirs` にこの土台(層とディレクトリ)を宣言する(' +
        verifierNote(LAYOUT_DEFINITION_CHECK) +
        '実装の木を宣言する製品はアプリの枠の後段を選ぶ — 選択の契約が止める)',
      counterexample: { layer: placement.layer, dir: placement.dir },
      location: placement.location,
    },
  ]);
}

/**
 * 役割 + キー → import に使うモジュール指定。決められなければ前提の失敗で止める。
 *
 * @param layout 生成の文脈の配置
 * @param placement 置き場を決めたい 1 件
 * @returns モジュール指定
 */
export function placedModule(layout: ProductLayout, placement: Placement): string {
  return layoutModule(layout, placement.role, placement.key) ?? unplaced(layout, placement, 'module');
}
