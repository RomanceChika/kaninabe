/**
 * `npm run verify` の終了コードを決める純関数。
 *
 * 既定は「エラー 0 件なら 0・1 件以上なら 1(警告のみなら 0)」である。**出荷を止めるのは未分類の警告**
 * (ADR-0008 の 2026-10-03 の追記)なので、`--fail-on-unclassified` を付けた実行は、未分類の警告が 1 件でも
 * あれば 1 を返す。**拡張候補に当たる警告は仕組みの宿題であり、門を閉じない**(区分は台帳が決める)。
 *
 * 門を付けるのは出荷の経路(CI の docs ジョブ・pre-commit)だけで、6 題材の通し実行などの既定の実行には
 * 付けない(題材は警告の件数を固定したテストが別に見ている)。台帳が読めない・無い構成では警告がすべて未分類に
 * なるので、門は閉じる(黙って分類済みにしない)。
 */

import { bucketCounts } from '../extension/bucket.js';
import type { ExtensionLedger } from '../model/extension/types.js';
import type { Finding } from '../kernel/finding.js';

/** 未分類の警告を門にするオプションの綴り。 */
export const FAIL_ON_UNCLASSIFIED_OPTION = '--fail-on-unclassified';

/** 終了コードの判断。 */
export interface ExitDecision {
  /** 終了コード(0 = 通過・1 = 失敗)。 */
  readonly code: 0 | 1;
  /** 門で止めたときの説明(止めていなければ null。エラーで 1 のときも null — エラーは各指摘が語る)。 */
  readonly gateNote: string | null;
}

/**
 * 引数に未分類の門が付いているか。
 *
 * @param args CLI の引数
 */
export function failOnUnclassifiedRequested(args: readonly string[]): boolean {
  return args.includes(FAIL_ON_UNCLASSIFIED_OPTION);
}

/**
 * 検証の全結果と門の有無から、終了コードを決める。
 *
 * @param findings 全 Finding
 * @param ledger 拡張候補の台帳(無ければ null。警告はすべて未分類として数える)
 * @param failOnUnclassified 未分類の警告を失敗にするか
 * @returns 終了コードと、門で止めたときの説明
 */
export function decideExit(findings: readonly Finding[], ledger: ExtensionLedger | null, failOnUnclassified: boolean): ExitDecision {
  if (findings.some((finding) => finding.severity === 'error')) return { code: 1, gateNote: null };
  if (!failOnUnclassified) return { code: 0, gateNote: null };
  const { unclassified } = bucketCounts(findings, ledger);
  if (unclassified === 0) return { code: 0, gateNote: null };
  return {
    code: 1,
    gateNote:
      `未分類の警告が ${String(unclassified)} 件あります(${FAIL_ON_UNCLASSIFIED_OPTION})。` +
      '出荷を止めるのは未分類です — 警告ごとの対処で仕様を直すか、仕組みの宿題なら拡張候補の台帳' +
      '(legacy/spec-tools/extension-candidates.md)に載せる(ADR-0008 の追記)',
  };
}
