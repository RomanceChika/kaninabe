/**
 * 道具の木の vitest の globalSetup: 仕組み側の配布物(`dist`)が古い・依存の置き場が根の外なら、テストを 1 本も回さずに 1 行で止める
 * (点検 19 回目 C19-1 / C19-2)。
 *
 * 題材の型検査(tsc)と子のプロセスで回す CLI(tsx)は `@kaninabe/runtime` の `dist` を読む。古いまま回すと TS2307 が並ぶ(誤って赤)か、
 * 古い評価器の JS で生成物と判定が一致して誤って緑になる。原因を名指しして止める。直し方は 1 行の中にある(`npm run build:framework` / `npm ci`)。
 */

import { REPO_ROOT, verdict } from '../../../../framework/runtime/scripts/check-dist-fresh.mjs';

/** vitest の globalSetup の口。 */
export default function setup(): void {
  const result = verdict(REPO_ROOT);
  if (result.line !== null) throw new Error(result.line);
}
