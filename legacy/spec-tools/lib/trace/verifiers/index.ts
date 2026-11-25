/**
 * トレース検証器レジストリ。
 *
 * 新しい検証器の追加は「TraceVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * A0(action_spec のスキーマ適合)はモデル構築と不可分なため lib/model/trace/loader.ts 内で
 * 実施され、この一覧には現れない(ドメイン側の V1 と同じ扱い)。
 * A9(テストケース ID の台帳)は action_spec の有無に依存しない横断検査なので、
 * この群ではなく lib/spec-index にある(そちらの ALL_SPEC_INDEX_VERIFIERS が正)。
 * A10(走査の網羅)は A4 の裏返し(system が起こすイベント)なのでこの群に属する。
 * A11(操作の閉世界)・A12(注釈の台帳)は実装 → 仕様の逆向き検査で、母集合は
 * scan.ts の走査結果(operationFiles / testFiles)である。
 * A16(注釈の中身)も同じく実装側を母集合とし、走査結果の testBlocks を読む。
 * A17 / A18 は access_spec の `writes` を母集合とする 2 つの隣どうしで、A17 は「動かせない欄」、
 * A18 は「執行されない規則」を報告する(どちらも仕様の宣言だけを読む)。
 * A19 は `computes` を母集合とし、**その純関数に材料が届くか**(宣言した `reads` が計画の
 * 読み取りに載るか)を報告する。A15 と同じ導出器を使うが、見ているものが違う —— A15 は
 * 「計画が組めるか」、A19 は「組めた計画が計算に材料を渡せるか」である。
 */

import type { TraceVerifier } from '../verifier.js';
import { handlesExistenceVerifier } from './a1-handles-existence.js';
import { pathConsistencyVerifier } from './a2-path-consistency.js';
import { inputExistenceVerifier } from './a3-input-existence.js';
import { handlerCoverageVerifier } from './a4-handler-coverage.js';
import { noDuplicateHandlesVerifier } from './a5-no-duplicate-handles.js';
import { testTraceVerifier } from './a6-test-trace.js';
import { semanticCoverageVerifier } from './a7-semantic-coverage.js';
import { specIdGroundingVerifier } from './a8-spec-ids.js';
import { systemScanCoverageVerifier } from './a10-system-scan-coverage.js';
import { undeclaredOperationsVerifier } from './a11-undeclared-operations.js';
import { untaggedTestsVerifier } from './a12-untagged-tests.js';
import { scheduleManualJobTagsVerifier } from './a13-schedule-manual-job-tags.js';
import { guardEnvParityVerifier } from './a14-guard-env-parity.js';
import { operationPlanVerifier } from './a15-operation-plan.js';
import { testAssertionsVerifier } from './a16-test-assertions.js';
import { writableFieldsVerifier } from './a17-writable-fields.js';
import { writeRuleEnforcementVerifier } from './a18-write-rule-enforcement.js';
import { computeFactsVerifier } from './a19-compute-facts.js';
import { uxOverrideReasonVerifier } from './v14-ux-override.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_TRACE_VERIFIERS: readonly TraceVerifier[] = [
  handlesExistenceVerifier,
  pathConsistencyVerifier,
  inputExistenceVerifier,
  handlerCoverageVerifier,
  noDuplicateHandlesVerifier,
  testTraceVerifier,
  semanticCoverageVerifier,
  specIdGroundingVerifier,
  systemScanCoverageVerifier,
  undeclaredOperationsVerifier,
  untaggedTestsVerifier,
  scheduleManualJobTagsVerifier,
  guardEnvParityVerifier,
  operationPlanVerifier,
  testAssertionsVerifier,
  writableFieldsVerifier,
  writeRuleEnforcementVerifier,
  computeFactsVerifier,
  uxOverrideReasonVerifier,
];

/**
 * app/ を読めない構成(仕様だけを持つリポジトリ)で丸ごと飛ぶ検査器。
 *
 * 実行ログ(lib/compose/verify-pipeline.ts)と enforcement-matrix の C21 行が**同じ 1 か所**から宣言するための
 * 配列である(束 ㉑ の独立レビュー 9-A。手書きの範囲表記は腐る —— A16 を足した同じ束で
 * 「A11・A12・A14 をスキップする」と書いたままの散文が残っていた)。
 * 突合は `__tests__/unit/gates/matrix-range-parity.test.ts`。
 */
export const APP_ONLY_TRACE_VERIFIERS = ['A11', 'A12', 'A14', 'A16'] as const;
