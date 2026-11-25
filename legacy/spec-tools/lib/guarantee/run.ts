/**
 * 保証台帳検証(Z 群)の実行口。
 *
 * ローダー(Z0)が構築したカタログを検証器(Z1〜Z2)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は guarantee-spec-writing.md。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { TcRegistry } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { FrameworkLedgerLoad } from '../model/guarantee/framework-loader.js';
import { GUARANTEE_STEPS } from './checks.js';
import { frameworkNotRequestedNote, isDeclared } from './verifiers/z3-framework-scan.js';

/** runGuaranteeVerification の入力。 */
export interface GuaranteeRunInput {
  /** 構築済みのドメイン仕様モデル(spec_ids の接地先)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの保証台帳(Z0 はローダーが済ませてある)。 */
  readonly guarantee: GuaranteeSpecModel;
  /** テストケース ID 台帳(Z1 が guarantee_spec の宣言を引く)。 */
  readonly registry: TcRegistry;
  /** app/ の走査結果(Z1 の `@tc` 突合。読めない構成では Z1 は何も見ない)。仕組みの根の走査は `framework` に入れ子で持つ(Z3 が見る)。 */
  readonly tests: ScanWithFramework;
  /**
   * 仕組みの保証台帳の読み込みの結果(Z3 が見る)。省略は「渡していない」(`not_requested`。単体テスト用 — CLI は必ず渡す)。
   * 製品の台帳(`guarantee`)とは独立に読む: 仕組みの台帳は製品が外せない義務で、製品の台帳が無くても Z3 は走る。
   */
  readonly frameworkLedger?: FrameworkLedgerLoad;
}

/** runGuaranteeVerification の結果。 */
export interface GuaranteeRunResult {
  readonly findings: Finding[];
  /** 製品のカタログがあったか。false なら製品の台帳に依る Z1・Z2 の分は実行していない(仕組みの台帳に依る Z3 は別に走る)。 */
  readonly available: boolean;
  /** 読み込めた製品の保証の件数(CLI のサマリ表示用)。 */
  readonly guaranteeCount: number;
  /** app/ を走査できたか。false なら Z1 の製品の分はスキップされている。 */
  readonly testsAvailable: boolean;
  /** 仕組みの台帳を読み込めた保証の件数(読み込めていなければ 0)。 */
  readonly frameworkGuaranteeCount: number;
  /** 仕組みの根の走査と仕組みの台帳の両方が使えた(Z3 が突合した)か。片方でも欠けていれば false(欠けた分は Z3 が error で言う)。 */
  readonly frameworkScanned: boolean;
  /** 仕組みの根の注釈のうち、台帳に宣言があって突合した件数(仕組みの根を走査できていないときは 0)。 */
  readonly frameworkMatched: number;
  /** 範囲が縮んだ報告の行(Z3 が未実施のときなど)。実行ログへそのまま出す。 */
  readonly notes: readonly string[];
}

/**
 * 保証台帳の検証(Z1〜Z3)を実行する。
 *
 * 製品のカタログが無い環境では製品の分(Z1・Z2)が何も見ないだけで、**仕組みの台帳に依る Z3 は止まらない**
 * (保証台帳をまだ開設していないリポジトリでも壊れず、仕組みの約束は消えない)。
 *
 * @param input ドメインモデル・保証台帳・台帳・走査結果
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runGuaranteeVerification(input: GuaranteeRunInput): GuaranteeRunResult {
  const ledger = input.frameworkLedger ?? { state: 'not_requested' as const };
  const scan = input.tests.framework;
  const frameworkScanned = scan?.state.state === 'scanned' && ledger.state === 'loaded';
  const note = frameworkNotRequestedNote(input.tests, ledger);
  return {
    findings: GUARANTEE_STEPS.flatMap((step) => step.run(input)),
    available: input.guarantee.available,
    guaranteeCount: input.guarantee.catalog?.guarantees.length ?? 0,
    testsAvailable: input.tests.available,
    frameworkGuaranteeCount: ledger.state === 'loaded' ? (ledger.model.catalog?.guarantees.length ?? 0) : 0,
    frameworkScanned,
    frameworkMatched: frameworkScanned ? (scan?.annotations ?? []).filter((a) => isDeclared(input.registry, a)).length : 0,
    notes: note === null ? [] : [note],
  };
}
