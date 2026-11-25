/**
 * 画面検証器(ScreenVerifier)の共有インターフェース。
 *
 * S1〜S12 は「ドメイン仕様 + query_spec + screen_spec / chrome_spec + 実装のルート」を突き合わせるため、
 * 既存のどの検証器とも入力の型が異なる。既存のインターフェースは変更せず、
 * 入力だけを差し替えた別インターフェースをここに置く(Q 群と同じ流儀)。
 *
 * 検証器の性質は他の群と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: screen-spec-writing.md の S1〜S12。
 * 新しい検証器の追加は、この ScreenVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_SCREEN_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import { makeFinding, type FindingArgs, type Finding } from '../kernel/finding.js';
import type { GuardServices } from '../guard/ast.js';
import type { ScreenInput } from '../model/screen/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import type { ReachabilityGap } from '../relations/screen-reachability/index.js';

export type { Finding } from '../kernel/finding.js';

/** 画面検証器に注入される共有サービス(VerifyContext と同じ流儀)。 */
export interface ScreenContext {
  readonly guards: GuardServices;
  /** 製品が宣言した根(道案内のパスと実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(画面の器・リクエスト前段・画面テストの置き場の読み取り先。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
  /**
   * `runner: manual` を宣言した操作の ID(action_spec 由来。S17 の (e) が読む)。
   * action_spec を読めていなければ空(宣言した操作が無い = S17 の (e) は何も言わない)。
   */
  readonly manualOperations: ReadonlySet<string>;
  /**
   * 操作 ID(`handles` に書かれたまま)→ その操作の入力の欄(action_spec の `input`。S18 の (d) が読む)。
   * action_spec を読めていなければ空(S18 の (d) は何も言わない)。
   */
  readonly operationInputs: ReadonlyMap<string, readonly OperationInput[]>;
  /**
   * 確認が要る操作の ID(`handles` に書かれたまま。方針の導出 = `deriveOperationAttributes` の `confirmRequired` で、
   * action_spec の `ux` の上書きを適用した後。S19 の (c) が読む)。
   * action_spec を読めていなければ空(S19 の (c) は何も言わない)。
   */
  readonly confirmRequiredOperations: ReadonlySet<string>;
  /**
   * 画面の到達の入力のうち使えなかったもの(`relations/screen-reachability` の `gaps`。製品が screens を採っていない・
   * 採ったのに読めない・読めずに捨てた仕様がある)。**空でなければ、画面の到達を読む検査(S13・S16)は判定を出さない**(関門の阻害だけは、関門に依る S14・S15 の判定も出さない = `authGateBlocked`)
   * (使えない入力から到達を導かない。見ていないことは `verify/reachability-notes.ts` が行で言う)。空は「使える」。
   * **必須**(任意の欄にすると、渡し忘れた呼び手の S13・S16 が黙って「使える」として回る)。
   */
  readonly reachabilityGaps: readonly ReachabilityGap[];
  /**
   * 画面の検査が他の種類から引く材料のうち、**阻害**(採ったのに検査へ渡せない = 置き場が無い・読めない・読めずに捨てた仕様がある)のもの。
   * 阻害の材料に依る判定(`reads` の指す読み取りクエリの実在・状態の可視性・保存点の実在など)は**出さない**(欠けたモデルで「無い」と言うと偽の error になる。
   * 見ていないことは `verify/operation-input-notes.ts` が検査ごとに行で言う)。**出せる判定は出す**: 読めた保存点の手順の露出・到達(S16)・宣言の実在(S14 の `unseen_states`)。
   * 欠けた材料を「否定できない」側に倒していて保留が要らない検査(S12)は、これを引かない(ただし倒す分岐に届くのは読めて仕様を落としただけの阻害まで。置き場ごと無い・読めない阻害は実行されず、行が名指す)。未選択は事実として無いので、ここには載せない。
   * **必須**(任意の欄にすると、渡し忘れた呼び手の検査が黙って「使える」として回る)。
   */
  readonly blockedInputs: readonly ScreenForeignInput[];
}

/** 画面の検査が他の種類から引く材料(読み取りクエリ・ユースケース)。 */
export type ScreenForeignInput = 'queries' | 'usecases';

/** 操作の入力の欄 1 つ(`{entity}.{field}`)。 */
export interface OperationInput {
  readonly entity: string;
  readonly field: string;
}

/** 全画面検証器が実装するインターフェース。 */
export interface ScreenVerifier {
  /** "S1"〜"S10"。screen-spec-writing.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 入力全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(input: ScreenInput, ctx: ScreenContext): Finding[];
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている(A 群の traceFinding・Q 群の queryFinding と同じ)。
 *
 * @param verifier 検証器 ID(例: "S2")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function screenFinding(verifier: string, args: FindingArgs): Finding {
  return makeFinding(verifier, args);
}

/**
 * 認証フローの関門の入力が阻害か(採ったのに関門が分からない)。関門の有無で決まる判定(入れるロール・見える画面)は、
 * 関門が分からないまま出さない(空の関門で決めると、入れない画面にも入れると広く見積もる)。画面の入力の欠けは含まない。
 *
 * @param ctx 画面検証器に注入される共有サービス
 */
export function authGateBlocked(ctx: ScreenContext): boolean {
  return ctx.reachabilityGaps.some((gap) => gap.input === 'auth');
}

/**
 * 画面の検査が他の種類から引く材料が阻害か(欠けた材料で偽になる判定を出さない。読めた分で真に言える判定は出す)。
 *
 * @param ctx 画面検査器に注入される共有サービス
 * @param input 材料の種類
 */
export function foreignBlocked(ctx: ScreenContext, input: ScreenForeignInput): boolean {
  return ctx.blockedInputs.includes(input);
}
