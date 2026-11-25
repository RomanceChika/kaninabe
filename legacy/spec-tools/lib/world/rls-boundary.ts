/**
 * テナント境界(`reads[].filters`)の**右辺の値をどこから読むか**の計画。
 *
 * 境界の右辺 `actor.{欄}` の値の正は**実行者の行**であり、セッションの写し(JWT の属性)ではない ——
 * 写しは最長でトークンの寿命だけ古く、運営が利用者の所属を付け替えたあとも、写しを信じる述語は
 * 古い所属の行を見せ続ける。書き込みの側(`when: actor.{欄}`。`rpc-reach.ts`)が既に行を読んでいるので、
 * 読み取りも同じ正に揃える。
 *
 * ポリシーの中から実行者の集約を直に読むと、その集約自身のポリシーで再帰する(実行者の集約そのものに
 * 境界を書いた表で起きる)。そこで役の判定(`is_{role}()`)と同じく **security definer の補助関数**に
 * 逃がす。関数名は欄から機械的に決まり(`actor_{欄}`)、宣言は実行者の集約の data_table の
 * `functions[]`(`kind: helper` + `actor_field:` + `migration:`)に置く(T7 が両方向を見る)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PolicyPlan } from './rls-plan.js';

/** 実行者の同一性の欄(行を読まずに現在の実行者の式で埋まるので、補助関数を持たない)。 */
const ACTOR_ID_FIELD = 'id';

/**
 * その境界が補助関数を要るか(`actor.id` は現在の実行者の式そのものなので要らない)。
 *
 * @param field 実行者の欄(`actor.{欄}` の `{欄}`)
 * @returns 補助関数を呼ぶなら true
 */
export function needsBoundaryHelper(field: string): boolean {
  return field !== ACTOR_ID_FIELD;
}

/**
 * その計画たちの境界が要求する**実行者の欄**(補助関数を要るものだけ。宣言順・重複なし)。
 *
 * @param plans ポリシーの計画
 * @returns 補助関数が要る実行者の欄
 */
export function boundaryHelperFields(plans: readonly PolicyPlan[]): readonly string[] {
  const needed: string[] = [];
  for (const plan of plans) {
    for (const filter of plan.filters) {
      if (needsBoundaryHelper(filter.actorField) && !needed.includes(filter.actorField)) needed.push(filter.actorField);
    }
  }
  return needed;
}

/**
 * 境界の補助関数の名前(実行者の欄から機械的に決まる)。
 *
 * @param field 実行者の欄
 * @returns 関数名(スキーマ修飾なし)
 */
export function boundaryHelperName(field: string): string {
  return `actor_${field}`;
}
