/**
 * 人向けの表示の章の**共通の骨格**。集約の章・タスクの章・通知・ジョブ・画面の章が、同じ形をここから呼ぶ。
 *
 * 章の形は **章頭 → 読む量の 4 枚 → 前提の語 → 凡例 → 上段(公理)→ 下段(導出)→ 数の出どころ** で、層(集約・通知・
 * ジョブ・画面)に依らない。ここが持つのは形だけで、**製品の語は 1 つも持たない**: 何が公理で何が導出かは
 * `semantics/reading-class.ts` の表が決め(行は表の種類を型で受け取る)、数は章ごとの集計が渡す。読む量の 4 枚は
 * `face-budget.ts`、受け入れの節は `html/layer-chapter.ts`、印・17 語のラベル・折りたたみ・原文の二層は `face-html.ts` が持つ
 * (別の部品は作らない)。
 *
 * 数の食い違いを防ぐため、4 枚の数・本文の項目・「数の出どころ」・レビューの手引きは同じ集計から出る。
 */

import type { ElementsOf } from '../../../semantics/reading-class.js';
import { esc, kvs, mark, pts } from './face-html.js';

/** 上段の行に付ける種類(読み方の表が公理と決めたものだけ)。 */
export type AxiomElement = ElementsOf<'axiom'>;

/**
 * 上段の公理 1 行(行頭に読み方の印 = 異議の場所)。ラベル行(`kvs`)を右に置く。
 *
 * 行は**宣言の単位 1 つ**で、1 行に印は 1 つ。`data-el` は、その行が載せる公理の種類(読み方の表の鍵)を残す。
 *
 * @param head 行頭の見出し(HTML。ID と表示名)
 * @param rows ラベル行(`kv`)
 * @param elements この行が載せる公理の種類
 * @param anchor 行へ飛ぶための `id`(任意)
 */
export function axiomRowHtml(head: string, rows: readonly string[], elements: readonly AxiomElement[], anchor?: string): string {
  const id = anchor === undefined ? '' : ` id="${esc(anchor)}"`;
  return (
    `<div class="bf-axiom"${id} data-el="${elements.join(' ')}"><div class="bf-id">${head} ${mark('axiom')}</div>` +
    `<div class="bf-st">${kvs(rows)}</div></div>`
  );
}

/** 表のセル 1 つ(箇条。`|` は表を割るので実体参照にする)。 */
export function items(list: readonly string[]): string {
  return pts(list).replace(/\|/g, '&#124;');
}

