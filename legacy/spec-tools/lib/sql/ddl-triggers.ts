/**
 * **このファイルが出すトリガ**(本文が生成物になるもの)の引き当て。
 *
 * 6 家族ある —— 祖先の列の写しを埋めるもの(`ddl-copy-triggers.ts`)・同じ行の日時列 ± 定数の幅で
 * 埋めるもの(`ddl-derive-triggers.ts`)・条件を課すもの(`ddl-check-triggers.ts`)・その条件が参照される表の側で
 * 破れる端を見るもの(`ddl-ref-check-ends.ts`。宣言は相手の表の自表の執行点と不変条件の `formal`。fix25s)・未ログインの作成の
 * 天井を課すもの(`ddl-ceiling-triggers.ts`。宣言は data_table でなく access_spec の `creates[].abuse`)・作成の後に変えない列を
 * 凍らせるもの(`ddl-freeze-triggers.ts`。宣言は `triggers[].freezes`。点検 fix26 2 回目)である。
 * どれも「値の決め方 / 条件の確かめ方が**宣言から完全に読める**」ものだけが反映される。
 * ここが持つのはその 4 つを並べて、**手書きと宣言されたものを外す**という 1 つの判断だけである
 * (`ddl-plan.ts` がこの判断を呼ぶ)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { copyTriggersIn } from './ddl-copy-triggers.js';
import { checkTriggersIn } from './ddl-check-triggers.js';
import { deriveTriggersIn } from './ddl-derive-triggers.js';
import { ceilingTriggersIn } from './ddl-ceiling-triggers.js';
import { refCounterpartTriggersIn } from './ddl-ref-check-ends.js';
import { freezeTriggersIn } from './ddl-freeze-triggers.js';
import type { DdlTrigger } from './ddl-guards.js';

/**
 * その表の DDL が出すトリガのうち、**本文が生成物になるもの**(宣言順。写しが先)。
 *
 * **`functions[].handwritten` を宣言した関数は出さない。** 既に手書きの migration が同じ
 * 関数を作っている表では、生成に切り替えると**動いている執行点を置き換える**ことになるので、
 * そこは人の判断に残す(`checks[].handwritten` と同じ語・同じ形。理由の無い宣言は T 群が
 * 止める)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @param tables 全 data_table(写し元の物理テーブル名を引く)
 * @returns 生成するトリガ
 */
export function generatedTriggers(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): readonly DdlTrigger[] {
  const handwritten = new Set(
    table.functions.filter((fn) => fn.handwritten !== undefined).map((fn) => fn.name),
  );
  return [
    ...copyTriggersIn(table, domain, tables),
    ...deriveTriggersIn(table, domain),
    ...checkTriggersIn(table, domain, tables),
    ...refCounterpartTriggersIn(table, domain, tables),
    ...ceilingTriggersIn(table, domain),
    ...freezeTriggersIn(table, domain),
  ].filter((trigger) => !handwritten.has(trigger.function.name));
}
