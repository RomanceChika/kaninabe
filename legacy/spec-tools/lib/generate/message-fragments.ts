/**
 * 生成物の日本語を分解するための**断片の全数**を集める(出力側の目の入力)。
 *
 * 文言の表そのもの(`lib/messages/**`)は文言の層にあり、生成側・SQL の導出・検証器の
 * どれからも読まれる。ここは**表を束ねるだけの集約**で、仕組みが自分で持つ DB オブジェクトの
 * 宣言(`sql/framework-tables.ts` ・`sql/framework-guards.ts`)と層・置き場の宣言
 * (置き場の配置が宣言する表。`model/framework-base-dirs.ts` の口)も読むので、文言の層の外に置く。
 */

import { frameworkAuxFiles, frameworkBaseDirs, frameworkLayers } from '../model/framework-base-dirs.js';
import type { ProductLayout } from '../model/product/layout.js';
import { frameworkGuardWords } from '../sql/framework-guards.js';
import { frameworkTableWords } from '../sql/framework-tables.js';
import { cronRouteFragments } from '../messages/messages-cron.js';
import { ceilingFragments } from '../messages/messages-ddl.js';
import { browserDefenseFragments } from '../messages/messages-browser-defense.js';
import { eqTestFragments } from '../messages/messages-eq.js';
import { FIXED_FRAGMENTS } from '../messages/messages.js';
import { resultFragments } from '../messages/messages-results.js';
import { rlsTestFragments } from '../messages/messages-rls.js';
import { structureFragments } from '../messages/messages-structure.js';

/**
 * 層・置き場の説明(置き場の配置が宣言する表と層の 4 名の `role`)。
 *
 * 生成物 `structure-expectations.ts` に写るので、出力側の目にはこれも「仕組みの文言」
 * として見える。**表を 2 つ持たない**ため、ここでは宣言を引くだけにする。
 *
 * @param layout 置き場の配置(表の宣言元)
 * @returns 説明文の全数(層・土台・補助ファイルの順)
 */
export function frameworkRoleWords(layout: ProductLayout): readonly string[] {
  return [
    ...frameworkLayers(layout).map((layer) => layer.role),
    ...frameworkBaseDirs(layout).map((entry) => entry.role),
    ...frameworkAuxFiles(layout).map((entry) => entry.role),
  ];
}

/**
 * 生成物の日本語を分解するための断片の全数。
 *
 * @param layout 置き場の配置(層・土台の説明の宣言元)
 * @returns 固定の文言 + 層・置き場の説明 + 仕組みが持つ表の列と執行点の説明 + 生成テストの文言 + 結果表 + 期待木の置き場の表示名 + Cron 起動口の見張りテストの文言 + 天井の鍵の受け入れの理由
 */
export function messageFragments(layout: ProductLayout): readonly string[] {
  return [
    ...FIXED_FRAGMENTS,
    ...frameworkRoleWords(layout),
    ...frameworkTableWords(),
    ...frameworkGuardWords(),
    ...rlsTestFragments(),
    ...eqTestFragments(),
    ...resultFragments(),
    ...structureFragments(),
    ...cronRouteFragments(),
    ...browserDefenseFragments(),
    ...ceilingFragments(),
  ];
}
