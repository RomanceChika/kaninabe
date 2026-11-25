/**
 * クエリ検証器(QueryVerifier)の共有インターフェース。
 *
 * Q1〜Q7 は「ドメイン仕様 + query_spec + app/ の走査結果」を突き合わせるため、
 * ドメイン検証器(`Verifier`)ともトレース検証器(`TraceVerifier`)とも入力の型が異なる。
 * 既存のインターフェースは変更せず、入力だけを差し替えた別インターフェースをここに置く
 * (出力の `Finding` は共通で、CLI は同じ整形器で出力できる)。
 *
 * 検証器の性質は他の群と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: query-spec-writing.md の Q1〜Q7。
 * 新しい検証器の追加は、この QueryVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_QUERY_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import { makeFinding, type FindingArgs, type Finding } from '../kernel/finding.js';
import type { GuardServices } from '../guard/ast.js';
import type { QueryInput } from '../model/query/types.js';

export type { Finding } from '../kernel/finding.js';

/** クエリ検証器に注入される共有サービス(VerifyContext と同じ流儀)。 */
export interface QueryContext {
  readonly guards: GuardServices;
}

/** 全クエリ検証器が実装するインターフェース。 */
export interface QueryVerifier {
  /** "Q1"〜"Q7"。query-spec-writing.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 入力全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(input: QueryInput, ctx: QueryContext): Finding[];
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている(A 群の traceFinding と同じ)。
 *
 * @param verifier 検証器 ID(例: "Q2")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function queryFinding(verifier: string, args: FindingArgs): Finding {
  return makeFinding(verifier, args);
}
