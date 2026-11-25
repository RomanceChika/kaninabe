/**
 * 「あるロールが、ある起点からナビゲーションで辿り着ける画面はどこまでか」の探索(1 本)。
 *
 * 以前は起点の違う 2 つの探索が別のディレクトリに居た —— S13 / L2 の「`entry_point` 全部から」(`lib/screen/`)と、
 * Y3 / S16 / 通る画面の数えの「ユースケースの `start` から」(`lib/usecase/`)。辺の絞り込み(`{event}.success` を
 * 辿らない)・ロールでの入場判定は同じ規則なので、**起点を引数にして 1 つの探索にした**(`ReachStart`)。
 * 探索の順序(後入れ先出し)も従来のまま。
 */

import type { ScreenSpec } from '../../model/screen/types.js';
import { SUCCESS_SUFFIX } from '../../model/screen/lookup.js';
import type { ReachStart, ScreenReach } from './types.js';

/**
 * 起点の画面を引く(ロールが入れるものだけ)。
 *
 * - `entry-points`: `entry_point` の画面のうちロールが入れるもの全部
 * - `screen`: 指定した 1 画面。実在しない / ロールが入れないなら起点なし(= 空)
 */
function startScreens(
  screens: readonly ScreenSpec[],
  byId: ReadonlyMap<string, ScreenSpec>,
  canEnter: (screen: ScreenSpec) => boolean,
  start: ReachStart,
): readonly ScreenSpec[] {
  if (start.kind === 'entry-points') return screens.filter((screen) => screen.entryPoint && canEnter(screen));
  const found = byId.get(start.id);
  return found !== undefined && canEnter(found) ? [found] : [];
}

/**
 * 指定したロールが、起点から `navigations` を辿って到達できる画面。
 *
 * 辺は `on` が `{イベント ID}.success` 形でない `navigations`(= UI 都合の遷移)だけを辿る
 * ——`.success` は操作の**結果**として辿り着くものであり、押す前から「そこへ行ける」とは
 * 言えないため(screen-spec-writing.md §S13)。途中の画面もそのロールが入れるものだけを通る
 * (入れない画面の先にあるリンクは、押しに行けないので経路として数えない)。
 *
 * @param screens 全画面
 * @param canEnter ロール固定の入場判定(`roleCanEnter` を呼び手がロールで閉じたもの)
 * @param role 判定するロール ID
 * @param start 起点(`entry-points` または特定の画面)
 * @returns ロール・起点を添えた結果。起点自身を含む。起点が実在しない / 入れないなら空
 */
export function reachFrom(
  screens: readonly ScreenSpec[],
  canEnter: (screen: ScreenSpec) => boolean,
  role: string,
  start: ReachStart,
): ScreenReach {
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const starts = startScreens(screens, byId, canEnter, start);
  const reached = new Set(starts.map((screen) => screen.id));
  const queue = [...starts];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    for (const navigation of current.navigations) {
      if (navigation.on.endsWith(SUCCESS_SUFFIX)) continue;
      if (reached.has(navigation.to)) continue;
      const next = byId.get(navigation.to);
      if (next === undefined) continue; // 実在しない遷移先は S2 が指摘済み
      if (!canEnter(next)) continue;
      reached.add(next.id);
      queue.push(next);
    }
  }
  return { role, start, screenIds: reached };
}
