/**
 * 拡張候補の台帳(W5)の配線(lib/compose/verify-pipeline.ts から分離)。
 *
 * 台帳は仕組み自身のパッケージにあり製品に依らない(`model/extension/loader.ts`)。読むのはパイプラインの先頭
 * (モデルを構築できなかった実行でも、警告の区分に使えるように)、検査は**最後**(他の全群の結果を見る)。
 */

import type { AcceptedRiskDecl, Finding } from '../kernel/finding.js';
import type { ProgressLog } from './group-contract.js';
import { defaultLedgerFile, loadExtensionLedger, type LoadExtensionLedgerResult } from '../model/extension/loader.js';
import { runExtensionLedger } from '../extension/run.js';

/**
 * 台帳を読む。
 *
 * @returns 台帳のモデルとスキーマ違反
 */
export function loadExtension(): LoadExtensionLedgerResult {
  return loadExtensionLedger(defaultLedgerFile());
}

/**
 * 台帳の検査(W5)を、他の全群の結果に対して実行し、区分の件数を一行で残す。
 *
 * @param loaded 読んだ台帳
 * @param findings 他の全群の結果
 * @param knownIds 全検査の表(`lib/compose/all-checks.ts`)にある検査 ID(台帳の `rules` の実在の判定に使う。組み立ての根が渡す)
 * @param acceptances 読めた仕様が宣言した受け入れた危険(警告の `acceptance` の突合相手)
 * @param log 実行状況の 1 行報告
 * @returns W5 の Finding(台帳のスキーマ違反と、警告の出方との整合の違反)
 */
export function runExtension(
  loaded: LoadExtensionLedgerResult,
  findings: readonly Finding[],
  knownIds: ReadonlySet<string>,
  acceptances: readonly AcceptedRiskDecl[],
  log: ProgressLog,
): Finding[] {
  const run = runExtensionLedger({
    model: loaded.model,
    loadFindings: loaded.findings,
    findings,
    knownIds,
    acceptances,
  });
  for (const line of run.lines) log(line);
  return run.findings;
}
