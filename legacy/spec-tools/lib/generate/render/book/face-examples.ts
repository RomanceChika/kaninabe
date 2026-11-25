/**
 * 章の上段の「計算の早見表」(必読に数える公理のうち、`computes[].examples` の行)。
 *
 * 計算される欄の**式**は DSL の外の純関数にあり、仕様からは読めない。代わりに「この入力ならこの値」の行を
 * 仕様に宣言させ、ここで表にして人に見せる。**数える単位は行**で、1 行は主張 1 つである(行頭に読み方の印)。
 * 人が判定するのは各行の値が業務の規則どおりかで、機械が保証するのは**生成したユニットテストが純関数の
 * 実際の値とこの表の一致を確かめること**だけである(一致しなければ、式か表のどちらかが間違っている)。
 *
 * 表の形は呼び口(`shape`)で決まる:
 *
 * - `facts_input` … 列 = 行の名前 + 読んだ事実の欄 + 入力の欄(見出しは欄の表示名。無ければ内部名)+ 値。
 *   与えなかった欄は「—」
 * - `input` … 関数の引数が入れ子の値なので、列は 行の名前 / 入力 / 値 の 3 つで、入れ子は箇条にほどいて出す
 *   (平らなマッピング 1 つが 1 行。値の欄は書かれた分だけで、照合も書かれた分だけである)
 *
 * 計算される欄の宣言(欄 → 純関数)は導出として下段に出す(`html/aggregate-lower.ts`)。
 */

import type { ComputeExampleValue } from '../../../model/trace/types.js';

/** 数のけた区切り(整数のみ。ロケールに依らず同じ字面にする)。 */
export function grouped(value: number): string {
  const [integer = '', fraction] = String(value).split('.');
  const body = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? body : `${body}.${fraction}`;
}

/** 例の行の中で使われている鍵(`order` の並びを土台に、並びに無いものは出てきた順で足す)。 */
export function usedKeys(order: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const used = new Set(rows.flat());
  const known = order.filter((key) => used.has(key));
  const extra = [...used].filter((key) => !order.includes(key));
  return [...known, ...extra];
}

/** スカラーだけを値に持つマッピングか(1 行に畳める入れ子の最小単位)。 */
export function isFlatRecord(value: ComputeExampleValue): value is { readonly [key: string]: string | number | boolean | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((item) => item === null || typeof item !== 'object');
}

