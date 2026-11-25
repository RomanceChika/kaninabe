/**
 * L2 網羅スイープ — ② 画面 × 操作 の行を screen_spec から機械的に導出する。
 *
 * 母集合は S10(UI 到達の網羅検査)と同じ切り口 — screen_spec の `actions`(重ね表示の
 * `actions` も画面の一部として数える。S10 の `exposedOperations` と同じ規則)。
 *
 * 「どこで確かめているか」は screen_spec の `test_cases`(`specIds` にその操作 ID を
 * 挙げているもの)から引く。`smoke`(E2E スモークがこの画面を通ることの宣言)は
 * 操作単位の証拠を持たない(画面を通る手順の要約でしかなく、どの操作を実行したかは
 * 宣言されていない)ため、行の証拠には混ぜず、画面の手がかり列に本数と要約を添えるだけに
 * 留める(過大に「確かめた」と主張しない)。
 */

import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import { toEvidence, type L2Row } from './l2-sweep-types.js';

/** 発火できる操作 1 件(画面本体、または重ね表示から)。 */
interface ExposedAction {
  readonly id: string;
  readonly overlay?: string;
}

/** 画面 1 枚が発火する操作の全部(本体の actions + 重ね表示の actions)。 */
function actionsOf(screen: ScreenSpec): readonly ExposedAction[] {
  const own = screen.actions.map((ref) => ({ id: ref.id }));
  const overlays = screen.overlays.flatMap((overlay) =>
    overlay.actions.map((ref) => ({ id: ref.id, overlay: overlay.id })),
  );
  return [...own, ...overlays];
}

/** 画面の手がかり列(ルート + smoke の本数・要約)。 */
function detailOf(screen: ScreenSpec): string {
  if (screen.smoke.length === 0) return screen.route;
  const summaries = screen.smoke.map((entry) => entry.summary).join('; ');
  return `${screen.route}(smoke ${screen.smoke.length} 本 — 画面全体の疎通のみ確認: ${summaries})`;
}

/**
 * 画面 × 操作の行を全件組み立てる。
 *
 * @param screens 読み込み済みの screen_spec(`available: false` / 省略なら空)
 */
export function buildScreenRows(screens: ScreenSpecModel | undefined): L2Row[] {
  if (screens?.available !== true) return [];
  const rows: L2Row[] = [];
  for (const screen of screens.screens) {
    const detail = detailOf(screen);
    for (const action of actionsOf(screen)) {
      const matched = screen.testCases.filter((tc) => tc.specIds.includes(action.id));
      rows.push({
        section: '画面 × 操作',
        subject: `${screen.id} × ${action.id}`,
        aspect: action.overlay === undefined ? '発火' : `発火(重ね表示 ${action.overlay})`,
        detail,
        evidence: matched.map((tc) => toEvidence(tc)),
      });
    }
  }
  return rows;
}
