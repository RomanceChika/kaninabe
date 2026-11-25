/**
 * ユースケース検証(Y 群)の配線(lib/compose/verify-pipeline.ts が呼ぶ)。
 *
 * 責務は pipeline の他の run* ヘルパーと同じ「入力の組み立てと実行状況の報告」だけである。
 */

import type { Finding } from '../kernel/finding.js';
import { verifierRange } from './verifier-range.js';
import type { ProgressLog } from './group-contract.js';
import { runUsecaseVerification } from '../usecase/run.js';
import type { UsecaseContext } from '../usecase/verifier.js';
import type { UsecaseInput } from '../usecase/derive.js';
import { logUsecaseInputGaps } from './usecase-input-notes.js';

/**
 * ユースケース検証(Y 群)を実行し、実行状況を一行で残す。
 *
 * specs/frontend/usecases が無い環境では検証をスキップし、その旨を報告する。
 * action_spec / screen_spec / auth_spec が無い場合も壊れない(それぞれの群がスキップ済みの
 * 状態を UsecaseInput にそのまま渡し、Y 群の側が「接地できない」を安全側で扱う)。
 * テーブル仕様(`ctx.dataTables`)が使えないとき、Y8 / Y10 / Y12 は判定を出さず、見ていないことを群の要約行の後で
 * 保存点を名指して言う(`usecase-input-notes.ts`)。
 */
export function runUsecases(input: UsecaseInput, ctx: UsecaseContext, log: ProgressLog): Finding[] {
  const result = runUsecaseVerification(input, ctx);
  if (!result.available) {
    log('Y 群(ユースケース仕様): specs/frontend/usecases が無いためスキップしました。');
    return result.findings;
  }
  log(
    `Y 群(ユースケース仕様): usecase_spec ${result.usecaseCount} 件に対し ` +
      `${verifierRange(result.verifierIds)} を実行しました。`,
  );
  logUsecaseInputGaps(input.usecases, ctx.dataTables, log);
  return result.findings;
}
