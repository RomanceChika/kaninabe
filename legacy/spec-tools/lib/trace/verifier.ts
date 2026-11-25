/**
 * トレース検証器(TraceVerifier)の共有インターフェース。
 *
 * ドメイン検証器(lib/check-api/contract.ts の `Verifier`)は `SpecModel` だけを入力に取るが、
 * A1〜A8 は「ドメイン仕様 + action_spec + app/ の走査結果」の 3 つを突き合わせるため、
 * 入力の型が異なる。そこで `Verifier` は変更せず、入力だけを差し替えた別インターフェースを
 * ここに置く(出力の `Finding` は共通で、CLI は同じ整形器で出力できる)。
 *
 * 検証器の性質はドメイン側と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: action-spec-writing.md の A1〜A8。
 * 仕様種に依存しない台帳検査(A9)はこの群ではなく lib/spec-index にある。
 * 新しい検証器の追加は、この TraceVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_TRACE_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import { makeFinding, type FindingArgs, type Finding } from '../kernel/finding.js';
import { runCatalogCheck, type CatalogInput, type CheckRun, type InputGapNote } from '../kernel/input-state.js';
import type { SpecKind } from '../model/product/uses.js';
import type { CatalogRunInput, TraceInput } from './input.js';

export type { Finding } from '../kernel/finding.js';

/** 全トレース検証器が実装するインターフェース。 */
export interface TraceVerifier {
  /** "A1"〜"A8"。action-spec-writing.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 入力全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(input: TraceInput): Finding[];
}

/**
 * 入力の状態を報告する検査(未選択なら「未実施」・採ったのに渡せなければ「阻害」・渡せれば「実行」)。
 *
 * 要る種類の入力が任意の欄だった検査は、その欄が無いと**何も言わずに通った**。この検査は
 * `run` が入力の状態つきの結果(`CheckRun`)を返し、**未実施・阻害の検査も数えて報告できる**。
 * `verify` は同じ実行の違反だけを返す(従来の呼び口。検査の本体は 1 つで、二重に走らない)。
 */
export interface InputStateTraceVerifier extends TraceVerifier {
  /** この検査が要る仕様の種類(`product.md` の `uses` の語)。 */
  readonly kind: SpecKind;
  /**
   * 入力の状態に応じて検査を回し、結果(未実施 / 阻害 / 実行と、読み込みと検査の診断)を返す。
   *
   * 受け取るのは `CatalogRunInput`(`TraceInput` の部分)だけで、**action_spec を持たない製品でも回せる**。
   */
  run(input: CatalogRunInput): CheckRun;
}

/** `runPartial` の結果。 */
export interface PartialRun {
  /** 判定を出した部分の違反(`verify` が返すものと同じ)。 */
  readonly findings: Finding[];
  /**
   * 使えなかった入力(未選択・阻害)のために見ていないこと。使えなかった入力ごとに 1 件。全部使えたなら空。
   *
   * **一部の判定だけが阻害に依る形も、検査の全体が依る形も、この 1 本で言う**(判定を出さなかった対象は `subjects` に名指す。
   * ジョブの阻害は「副作用がキューに積まれる種別か」に依る操作だけを出さない形、テーブル仕様の未選択・阻害は検査の全体を出さない形)。
   * **未選択を事実として扱う入力**(例: A10 の外部連携 —— 採っていなければ第 3 の発火元は無い)は、ここに載せない。
   */
  readonly gaps: readonly InputGapNote[];
}

/**
 * 検査の**一部だけ**が、ある種類の入力に依る検査(その入力が使えなければ、依る部分の判定だけを出さない)。
 *
 * 全体を阻害にすると、入力に依らない判定(例: 計画の組み立ての前段)まで失う。かといって阻害のカタログから
 * 判定を出すと、**欠けた事実から「要る / 要らない」を導く**。この検査は依る部分だけ判定を出さず、
 * どの対象を出さなかったかを `gaps` で返して、実行ログが 1 行ずつ報告する。`verify` は同じ実行の違反だけを返す。
 */
export interface PartialInputTraceVerifier extends TraceVerifier {
  /** 検査を回し、違反と、判定を出さなかった対象・見ていないことを返す。 */
  runPartial(input: TraceInput): PartialRun;
}

/** 検査器が、一部の判定だけを阻害として報告できるか。 */
export function isPartialInputVerifier(verifier: TraceVerifier): verifier is PartialInputTraceVerifier {
  return 'runPartial' in verifier;
}

/** 検査器が入力の状態を報告できるか。 */
export function isInputStateVerifier(verifier: TraceVerifier): verifier is InputStateTraceVerifier {
  return 'kind' in verifier && 'run' in verifier;
}

/**
 * カタログ 1 種類を要る検査を、入力の状態つきで定義する。
 *
 * @param definition 検査の ID・説明・要る種類・入力の取り出し方・検査の本体
 */
export function catalogTraceVerifier<T>(definition: {
  readonly id: string;
  readonly title: string;
  readonly kind: SpecKind;
  /** `CatalogRunInput` から、この検査が要るカタログの入力の状態を取り出す。 */
  readonly inputOf: (input: CatalogRunInput) => CatalogInput<T>;
  /** 使えるカタログ(0 件の空も)に対する検査の本体。 */
  readonly verifyCatalog: (catalog: T, input: CatalogRunInput) => Finding[];
}): InputStateTraceVerifier {
  const run = (input: CatalogRunInput): CheckRun =>
    runCatalogCheck(definition.inputOf(input), (catalog) => definition.verifyCatalog(catalog, input));
  return {
    id: definition.id,
    title: definition.title,
    kind: definition.kind,
    run,
    verify: (input) => [...run(input).verifierFindings],
  };
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている。
 *
 * @param verifier 検証器 ID(例: "A1")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function traceFinding(verifier: string, args: FindingArgs): Finding {
  return makeFinding(verifier, args);
}
