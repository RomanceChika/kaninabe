/**
 * ユースケース検証器レジストリ。
 *
 * 新しい検証器の追加は「UsecaseVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * Y0(usecase_spec のスキーマ適合)はモデル構築と不可分なため lib/model/usecase/loader.ts 内で
 * 実施され、この一覧には現れない(V1 / A0 / Q0 / S0 と同じ扱い)。
 */

import type { UsecaseVerifier } from '../verifier.js';
import { referenceExistenceVerifier } from './y1-reference-existence.js';
import { stepOrderVerifier } from './y2-step-order.js';
import { reachabilityVerifier } from './y3-reachability.js';
import { saveAtomicityVerifier } from './y4-save-atomicity.js';
import { budgetVerifier } from './y5-budget.js';
import { doneConsistencyVerifier } from './y6-done-consistency.js';
import { saveMigrationVerifier } from './y7-save-migration.js';
import { paramSourceVerifier } from './y8-param-source.js';
import { testTraceVerifier } from './y9-test-trace.js';
import { planResolutionVerifier } from './y10-plan-resolution.js';
import { stepKeyVerifier } from './y11-step-key.js';
import { saveRenderableVerifier } from './y12-save-renderable.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_USECASE_VERIFIERS: readonly UsecaseVerifier[] = [
  referenceExistenceVerifier,
  stepOrderVerifier,
  reachabilityVerifier,
  saveAtomicityVerifier,
  budgetVerifier,
  doneConsistencyVerifier,
  saveMigrationVerifier,
  paramSourceVerifier,
  testTraceVerifier,
  planResolutionVerifier,
  stepKeyVerifier,
  saveRenderableVerifier,
];
