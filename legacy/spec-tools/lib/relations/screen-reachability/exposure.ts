/**
 * 「どの画面が、どの操作を発火すると宣言しているか」の索引(操作 ID を正規化して引く)。
 *
 * 画面の到達(`state-role-reach.ts`)・ユースケースが手順を出す画面を探す導出・S10 が同じ母集合を読む
 * (「その操作を出す画面」の数え方を 2 度書かない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';
import { canonicalActionId } from '../../semantics/action-ground.js';

/**
 * 画面が発火すると宣言した操作の正規化 ID → その画面のリスト(S10 と同じ正規化規則)。
 *
 * @param domain ドメイン仕様全体(正規化に使う)
 * @param screens 全画面
 * @returns 正規化済みの操作 ID → その操作を宣言する画面のリスト
 */
export function buildExposedByMap(
  domain: SpecModel,
  screens: readonly ScreenSpec[],
): ReadonlyMap<string, readonly ScreenSpec[]> {
  const map = new Map<string, ScreenSpec[]>();
  for (const screen of screens) {
    for (const rawId of declaredActionIds(screen)) {
      const canonical = canonicalActionId(domain, rawId) ?? rawId;
      const list = map.get(canonical);
      if (list === undefined) map.set(canonical, [screen]);
      else list.push(screen);
    }
  }
  return map;
}
