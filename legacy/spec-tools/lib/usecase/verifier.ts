/**
 * ユースケース検証器(UsecaseVerifier)の共有インターフェース。
 *
 * Y1〜Y11 は「ドメイン仕様 + action_spec + screen_spec + auth_spec + usecase_spec」を
 * 突き合わせるため、他の群とは入力の型が異なる(query_spec の QueryVerifier と同じ理由)。
 *
 * 検証器の性質は他の群と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: usecase-spec-writing.md の Y1〜Y11。
 * 新しい検証器の追加は、この UsecaseVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_USECASE_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import { makeFinding, type FindingArgs, type Finding } from '../kernel/finding.js';
import type { GuardServices } from '../guard/ast.js';
import type { CatalogInput } from '../kernel/input-state.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { TcRegistry, TestScanResult } from '../testcase/types.js';
import type { UsecaseInput } from './derive.js';
import type { ReachabilityGap } from '../relations/screen-reachability/index.js';

export type { Finding } from '../kernel/finding.js';

/** ユースケース検証器に注入される共有サービス(QueryContext / VerifyContext と同じ流儀)。 */
export interface UsecaseContext {
  readonly guards: GuardServices;
  /**
   * テーブル仕様(data_table)の**入力の状態**(Y8 が「手順が呼ぶ RPC の引数名」を、Y10 / Y12 が保存点の実行計画と複合 RPC への
   * 写し方を引く)。任意の欄ではなく**必須**である。
   *
   * 以前は `dataTables?` で、欄が無い・`available: false` のどちらでも 3 つが**何も言わずに通った**。今は 3 つに分けて渡す ——
   * 未選択(`uses` に `data_tables` が無い)/ 阻害(採ったのに無い・読めない・壊れている)/ 読込済み(0 件もここ)。
   * **使えないとき、3 つとも判定を出さない**(保存点の手順が呼ぶ RPC は data_table にしか無く、無い入力から「RPC が無い」を導くと
   * 見ていないものを見たと報告する)。**未選択も「見られない」**(母集合は保存点で、data_table は裏づけを見る先)なので、
   * 見ていないことを実行ログが 1 行ずつ報告する(`verify/usecase-input-notes.ts`)。
   * 読み込みの診断(T0)は読み込んだ側が全体へ足しており、ここでは二重に数えない。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /**
   * action_spec の**入力の状態**(未選択 / 阻害 / 読込済み)。`UsecaseInput.actions` は読込済みのときだけモデル(未選択も阻害も null)で、
   * null は「事実として無い」とも「分からない」とも読めてしまうので、ここで区別する。任意の欄ではなく**必須**。
   *
   * **阻害のとき、action_spec の入力欄・上書き(`ux`)を読む検査は判定を出さない**: Y2(手順の入力が指す集約の作成順)・Y8 / Y10 / Y12(保存点の実行計画が
   * action_spec の入力欄を引く)は出さず、Y5 は入力と確認の数だけ数えない(手数・画面・概念・前提は action_spec に依らないので従来どおり)。
   * 未選択は「action_spec は無い」事実で、従来どおり判定する。見ていないことは `verify/operation-input-notes.ts` が行で言う。
   */
  readonly actions: CatalogInput<ActionSpecModel>;
  /** テストケース ID 台帳(Y9 が宣言を引く)。省略時は Y9 の突合を行わない。 */
  readonly registry?: TcRegistry;
  /** app/ の走査結果(Y9 が `@tc` を引く)。省略・`available: false` なら突合しない。 */
  readonly tests?: TestScanResult;
  /**
   * 画面の到達の入力のうち使えなかったもの(`relations/screen-reachability` の `gaps`)。**空でなければ、画面の到達を読む検査
   * (Y3 の判定・Y5 の「通る画面」と「前提」の予算)は出さない / 数えない**(見ていないことは `verify/reachability-notes.ts` が行で言う)。
   * 空は「使える」。**必須**(任意の欄にすると、渡し忘れた呼び手の Y3・Y5 が黙って「使える」として回る)。
   */
  readonly reachabilityGaps: readonly ReachabilityGap[];
}

/** 全ユースケース検証器が実装するインターフェース。 */
export interface UsecaseVerifier {
  /** "Y1"〜"Y11"。usecase-spec-writing.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 入力全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[];
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている(Q 群の queryFinding と同じ)。
 *
 * @param verifier 検証器 ID(例: "Y3")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function usecaseFinding(verifier: string, args: FindingArgs): Finding {
  return makeFinding(verifier, args);
}

/**
 * 画面の入力が阻害か(採ったのに画面が分からない)。画面の実在を前提にする判定(`start` の画面が実在するか)は、
 * 欠けたモデルで「実在する画面ではありません」と言わないよう、画面が分からないまま出さない。
 *
 * @param ctx ユースケース検証器に注入される共有サービス
 */
export function screensBlocked(ctx: UsecaseContext): boolean {
  return ctx.reachabilityGaps.some((gap) => gap.input === 'screens');
}
