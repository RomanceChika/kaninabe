/**
 * 拡張候補の台帳の検査(W5)の実行口。
 *
 * 台帳のスキーマ適合(loader が積む)と、警告の実際の出方との整合(`verifiers/w5-extension-ledger.ts`)を
 * 束ねる。整合は他の全群の結果を見るので、**パイプラインの最後**に呼ぶ。台帳が無い構成(`available: false`)は
 * 何も見ない(警告はすべて未分類になる)。
 */

import type { AcceptedRiskDecl, Finding } from '../kernel/finding.js';
import { bucketBreakdown, bucketCounts } from './bucket.js';
import type { ExtensionLedgerModel } from '../model/extension/types.js';
import { verifyExtensionLedger } from './verifiers/w5-extension-ledger.js';

/** runExtensionLedger の入力。 */
export interface ExtensionLedgerRunInput {
  /** 台帳のモデル。 */
  readonly model: ExtensionLedgerModel;
  /** 台帳を読むときに出たスキーマ違反。 */
  readonly loadFindings: readonly Finding[];
  /** 他の全群の結果。 */
  readonly findings: readonly Finding[];
  /** 全検査の表にある検査 ID の集合(台帳の `rules` の実在の判定に使う)。 */
  readonly knownIds: ReadonlySet<string>;
  /** 読めた仕様が宣言した受け入れた危険(警告の `acceptance` の突合相手。組み立ての根が集める)。 */
  readonly acceptances: readonly AcceptedRiskDecl[];
}

/** runExtensionLedger の結果。 */
export interface ExtensionLedgerRunResult {
  /** 違反(スキーマ適合と整合)。 */
  readonly findings: Finding[];
  /** 実行状況の報告に出す行(区分の件数)。 */
  readonly lines: string[];
}

/**
 * 台帳の検査を実行する。
 *
 * @param input 台帳・他の群の結果・検査 ID の集合
 * @returns 違反と実行状況の行
 */
export function runExtensionLedger(input: ExtensionLedgerRunInput): ExtensionLedgerRunResult {
  const ledger = input.model.ledger;
  if (!input.model.available) {
    return { findings: [], lines: ['W 群(拡張候補の台帳): 台帳が無いので、警告はすべて未分類として数えます(W5 は何も見ません)。'] };
  }
  if (ledger === null) {
    return { findings: [...input.loadFindings], lines: ['W 群(拡張候補の台帳): 台帳を読めないので、警告はすべて未分類として数えます。'] };
  }
  const result = verifyExtensionLedger({ ledger, findings: input.findings, knownIds: input.knownIds, acceptances: input.acceptances });
  const counts = bucketCounts(input.findings, ledger);
  const open = ledger.candidates.filter((candidate) => candidate.status !== 'done').length;
  return {
    findings: [...input.loadFindings, ...result.findings],
    lines: [
      `W 群(拡張候補の台帳): 候補 ${String(ledger.candidates.length)} 件(未完了 ${String(open)})に対し W5 を実行しました` +
        `(警告 ${String(counts.accepted + counts.extension + counts.unclassified)} 件 = ${bucketBreakdown(counts)})。`,
    ],
  };
}
