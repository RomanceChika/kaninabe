/**
 * S3 到達可能性のチェック。
 *
 * screen-spec-writing.md の S3:「`entry_point: true` の画面が 1 つ以上あり、そこから
 * `navigations` を辿ってすべての画面に到達できる」。
 *
 * これは状態機械の到達可能性検証(V5)の画面版である。「作ったのにどこからも辿り着けない画面」は
 * 実装が済んでいても存在しないのと同じで、レビューでは最も見落とされやすい欠落になる
 * (1 画面ずつ読んでいる限り、欠けているのは**画面の外**にあるため見えない)。
 *
 * 辿るのは `navigations` だけで、`on_fail` の行き先は辿らない。入場条件に弾かれた人の
 * 逃げ道は「その画面へ行く道」ではないので、これを入口と数えると孤立画面が隠れる。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ScreenContext } from '../verifier.js';

/** S3: 全画面にナビゲーション上の入口があるかを検証する。 */
export const reachabilityVerifier: ScreenVerifier = {
  id: 'S3',
  title: '到達可能性 — エントリポイントから全画面に辿り着ける',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const screens = input.screens.screens;
    if (screens.length === 0) return [];

    const entries = screens.filter((screen) => screen.entryPoint);
    if (entries.length === 0) return [missingEntryPoint(screens, ctx.roots)];

    const reached = walk(screens, entries);
    return screens.filter((screen) => !reached.has(screen.id)).map(unreachable);
  },
};

/** エントリポイントから navigations を辿って到達できる画面 id を集める。 */
function walk(
  screens: readonly ScreenSpec[],
  entries: readonly ScreenSpec[],
): ReadonlySet<string> {
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const reached = new Set(entries.map((screen) => screen.id));
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    for (const navigation of current.navigations) {
      if (reached.has(navigation.to)) continue;
      const next = byId.get(navigation.to);
      // 実在しない遷移先は S2 が指摘済み。ここで重ねてエラーにしない。
      if (next === undefined) continue;
      reached.add(next.id);
      queue.push(next);
    }
  }
  return reached;
}

/** エントリポイントの宣言が 1 つも無い。 */
function missingEntryPoint(screens: readonly ScreenSpec[], roots: ProductRoots): Finding {
  const first = screens[0];
  return screenFinding('S3', {
    message: 'entry_point: true の画面が 1 つもありません',
    location: { file: first?.location.file ?? specPath(roots, 'frontend/screens') },
    suggestion:
      'ユーザーが最初に到達する画面(トップ・ログインなど)に entry_point: true を書く。' +
      '起点が無いと「どこからも辿れない画面」を機械が判定できない',
    counterexample: { screens: String(screens.length) },
  });
}

/** どこからも辿り着けない画面。 */
function unreachable(screen: ScreenSpec): Finding {
  return screenFinding('S3', {
    message: `画面 ${screen.name} にどこからも遷移してきません(孤立画面)`,
    location: screen.location,
    suggestion:
      `この画面へ来る画面の navigations に "to: ${screen.id}" を足す。` +
      '入口が本当に無いなら(直リンクだけで使う画面なら)entry_point: true を宣言する',
    counterexample: { screen: screen.name, route: screen.route },
  });
}
