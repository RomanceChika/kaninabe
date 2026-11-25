/**
 * 危ない形の検査(R 群)の束ね —— 実行口を呼び、阻害の入力のために見ていないことと実行状況を 1 行ずつ報告する。
 *
 * 検査の本体は `lib/risk/` の純関数で、ここは報告の文面(`check-run-report.ts`)をつなぐだけである。
 */

import type { Finding } from '../kernel/finding.js';
import type { ProgressLog } from './group-contract.js';
import { describeInputGapNote, describeTargetUnverified } from './check-run-report.js';
import { inputValue } from '../kernel/input-state.js';
import { abuseExposureOf } from '../model/external/abuse-exposure.js';
import { unverifiedNotesOf } from '../job/target-unverified.js';
import { NO_JOB_TARGETS, type JobTargetRegistry } from '../job/target-checks.js';
import { VERIFIER_ID as R5 } from '../risk/verifiers/r5-abuse.js';
import { runRiskChecks, type RiskInputs } from '../risk/run.js';
import { RISK_STEPS } from '../risk/checks.js';
import { VERIFIER_ID as R2 } from '../risk/verifiers/r2-ground-writers.js';

/**
 * R 群を実行し、報告する。
 *
 * @param inputs 材料(他の種類は入力の状態のまま)
 * @param log 実行状況の 1 行報告
 * @param jobTargets 選んだ後段(後段が名指す未検証 = 本番の設定など仕様から見えないものの行を出す。省くと名指さない)
 * @returns 違反
 */
export function runRisk(inputs: RiskInputs, log: ProgressLog, jobTargets: JobTargetRegistry = NO_JOB_TARGETS): Finding[] {
  const run = runRiskChecks(inputs);
  for (const gap of run.gaps) log(describeInputGapNote(R2, gap));
  // 濫用の口(未ログインの作成・有料の口)があるときだけ、後段が「見えていない」と名指す(例: ホストの IP 単位の流量制限)。
  const exposure = abuseExposureOf(inputs.model, inputValue(inputs.external));
  for (const note of unverifiedNotesOf(jobTargets.targets, exposure)) log(describeTargetUnverified(R5, note));
  log(`R 群(危ない形): ${RISK_STEPS.map((step) => step.id).join('・')} を実行しました(違反 ${run.findings.length} 件)。`);
  return run.findings;
}
