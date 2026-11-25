/**
 * 台帳検査(SpecIndexVerifier)の共有インターフェース。
 *
 * この群が見るのは「全仕様を 1 つに集めたときにだけ言えること」であり、入力は
 * テストケース ID 台帳だけである(特定の仕様種のモデルを見ない)。そのため実行も
 * 仕様種の有無に依存しない — `specs/backend/actions` が無い構成でも、`query_spec` だけの
 * 重複はここで落ちる。A 群・Q 群のように「その仕様が読めたら実行する」条件の内側に
 * 置いてはならない(それが仕様種をまたぐ重複を見逃していた元の構造である)。
 *
 * 検証器の性質は他の群と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 */

import { makeFinding, type FindingArgs, type Finding } from '../kernel/finding.js';
import type { TcRegistry } from '../testcase/types.js';

export type { Finding } from '../kernel/finding.js';

/** 全台帳検査が実装するインターフェース。 */
export interface SpecIndexVerifier {
  /** 検証器 ID(例: "A9")。標準文書の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 台帳を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(registry: TcRegistry): Finding[];
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている(A 群の traceFinding と同じ)。
 *
 * @param verifier 検証器 ID(例: "A9")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function specIndexFinding(verifier: string, args: FindingArgs): Finding {
  return makeFinding(verifier, args);
}
