/**
 * L2 網羅スイープ(docs/book/sweep.md)の全行を組み立てる窓口。
 *
 * BACKLOG「E2E拡張束 — 4層テスト戦略」の L2 を実装したもの。「一通り試す」の母集合を
 * 仕様から機械的に導き(① 状態遷移 × 成立/不成立 ② 画面 × 操作 ③ 読み取り経路 × 実行ロール
 * ④ 通知 ⑤ ジョブ)、各行に既存の突合(各仕様種の `test_cases`)から証拠を充てるだけである。
 * **判定はしない**(赤くしない) — 証拠が 0 件の行を集めて、人に配る一覧を作るのが唯一の仕事。
 * 行の組み立ては種類ごとに l2-sweep-{transitions,states,screens,queries,catalogs}.ts が持ち、
 * ここはそれを順に呼ぶ窓口である。
 */

import type { SpecModel } from '../../model/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { buildTransitionRows } from './l2-sweep-transitions.js';
import { buildStateRows } from './l2-sweep-states.js';
import { buildScreenRows } from './l2-sweep-screens.js';
import { buildQueryRows } from './l2-sweep-queries.js';
import { buildJobRows, buildNotificationRows } from './l2-sweep-catalogs.js';
import type { L2Row } from './l2-sweep-types.js';

export type { L2Evidence, L2Row, L2Section } from './l2-sweep-types.js';
export { evidenceCell } from './l2-sweep-types.js';

/**
 * 全行(グループ順: 状態遷移 → 状態 → 画面 × 操作 → 読み取り経路 → 通知 → ジョブ)を組み立てる。
 *
 * @param model ドメイン仕様全体(① の母集合の出どころ)
 * @param ctx 読み込み済みの action_spec / screen_spec / query_spec / notification_spec / job_spec /
 *   auth_spec(状態遷移の「到達」「着地」・状態の「可視性」の出どころ)
 */
export function buildL2SweepRows(model: SpecModel, ctx: GenerateContext): readonly L2Row[] {
  return [
    ...buildTransitionRows(model, ctx.actions, ctx),
    ...buildStateRows(model, ctx),
    ...buildScreenRows(ctx.screens),
    ...buildQueryRows(ctx.queries),
    ...buildNotificationRows(model, ctx.notifications, ctx.actions),
    ...buildJobRows(model, ctx.jobs, ctx.notifications, ctx.actions),
  ];
}

/**
 * 証拠が 1 本も無い行だけを取り出す(章末「押さえるテストが1本も無い行」の一覧に使う)。
 *
 * **「状態」の行は対象外**にする — state_spec 自身は `test_cases` を持たず、可視性の裏付けは
 * テストではなく S14(仕様同士の突合)が機械的に見ている。ここに混ぜると「テストを足す対象」
 * であるかのように読めてしまい、章末の一覧の意味がぼやける。
 *
 * @param rows buildL2SweepRows が返した全行
 */
export function rowsWithoutEvidence(rows: readonly L2Row[]): readonly L2Row[] {
  return rows.filter((row) => row.section !== '状態' && row.evidence.length === 0);
}
