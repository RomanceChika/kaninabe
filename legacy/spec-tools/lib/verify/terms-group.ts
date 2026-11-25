/**
 * 用語の台帳(M7〜M9)の配線(lib/compose/verify-pipeline.ts から分離)。
 *
 * 責務は pipeline の他の run* ヘルパーと同じ「入力の読み込み位置と報告の文言」だけである。
 * 走査範囲は `terms/scope.ts` が**仕組み自身の住所**(規約・設計メモ・スキル・コード)と**製品の宣言**
 * (ブック・仕様・実装の木)から組む。
 */

import path from 'node:path';
import type { Finding } from '../kernel/finding.js';
import type { ProgressLog } from './group-contract.js';
import { loadTermLedgerModel } from '../model/terms/loader.js';
import { runTermVerification } from '../terms/run.js';
import { scanTermCorpus } from '../terms/scan.js';
import { termScanScope } from '../terms/scope.js';
import { detectRepoRoot } from '../io/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 用語の台帳を読み、M7〜M10・M12 を実行して実行状況を一行で残す。
 *
 * 台帳(`terms.md`)が無い環境では検証をスキップし、その旨を報告して壊れないようにする
 * (台帳をまだ開設していない製品でも verify は通る)。台帳のスキーマ違反(M11)は
 * ここで返す —— 読めなかった台帳に対して M7〜M9 は何も言わない。
 *
 * @param domainRoot specs/domain の絶対パス(台帳は仕様の木の直下にある)
 * @param roots 製品が宣言した根(ブック・仕様・実装の木の位置)
 * @param log 実行状況の 1 行報告
 * @returns M11・M7〜M9 の Finding
 */
export function runTerms(domainRoot: string, roots: ProductRoots, log: ProgressLog): Finding[] {
  const repoRoot = detectRepoRoot(domainRoot);
  const loaded = loadTermLedgerModel(path.join(path.dirname(domainRoot), 'terms.md'), { repoRoot });
  const ledger = loaded.model.ledger;
  if (ledger === null) {
    log('M7〜M10・M12(用語の台帳と人が書く文): 台帳(terms.md)が無い、または読めないためスキップしました。');
    return loaded.findings;
  }
  const corpus = scanTermCorpus(repoRoot, termScanScope(roots), ledger);
  const result = runTermVerification(loaded.model, corpus);
  log(
    `M7〜M10・M12(用語の台帳と人が書く文): ${result.termCount} 語を、${corpus.files.length} 枚の本文とコードのコメントに照らし、人が書く文 ${corpus.summaries.length} 件の文体と語の接地を検査しました。`,
  );
  return [...loaded.findings, ...result.findings];
}
