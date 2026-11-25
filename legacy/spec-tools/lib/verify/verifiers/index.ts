/**
 * 検証器レジストリ。
 *
 * 新しい検証器の追加は「Verifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * V1(スキーマ適合)はモデル構築と不可分なため loader 内で実施され、この一覧には現れない。
 */

import type { Verifier } from '../../check-api/contract.js';
import { referenceIntegrityVerifier } from './v2-reference-integrity.js';
import { transitionTotalityVerifier } from './v3-transition-totality.js';
import { readTotalityVerifier } from './v4-read-totality.js';
import { reachabilityVerifier } from './v5-reachability.js';
import { deadEndVerifier } from './v6-dead-end.js';
import { finalImmutabilityVerifier } from './v7-final-immutability.js';
import { determinismVerifier } from './v8-determinism.js';
import { guardSatisfiabilityVerifier } from './v9-guard-satisfiability.js';
import { invariantEnforcementVerifier } from './v10-invariant-enforcement.js';
import { roleGroundingVerifier } from './v11-role-grounding.js';
import { snapshotMappingVerifier } from './v12-snapshot-mapping.js';
import { sessionFieldScopeVerifier } from './v13-session-field-scope.js';
import { enumLabelsVerifier } from './v16-enum-labels.js';
import { suppliedByDbVerifier } from './v17-supplied-by-db.js';
import { computesVerifier } from './v18-computes.js';
import { recordsActorVerifier } from './v19-records-actor.js';
import { tenantBoundaryVerifier } from './v20-tenant-boundary.js';
import { boundedReachabilityVerifier } from './v21-bounded-reachability.js';
import { displayFieldVerifier } from './v22-display-field.js';
import { loginRoleStateConditionVerifier } from './v23-login-role-state-condition.js';
import { stateClaimSupportVerifier } from './v24-state-claim-support.js';
import { mirrorAccessVerifier } from './v25-mirror-access.js';
import { tenantWriteBoundaryVerifier } from './v26-tenant-write-boundary.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_VERIFIERS: readonly Verifier[] = [
  referenceIntegrityVerifier,
  transitionTotalityVerifier,
  readTotalityVerifier,
  reachabilityVerifier,
  deadEndVerifier,
  finalImmutabilityVerifier,
  determinismVerifier,
  guardSatisfiabilityVerifier,
  invariantEnforcementVerifier,
  roleGroundingVerifier,
  snapshotMappingVerifier,
  sessionFieldScopeVerifier,
  enumLabelsVerifier,
  suppliedByDbVerifier,
  computesVerifier,
  recordsActorVerifier,
  tenantBoundaryVerifier,
  boundedReachabilityVerifier,
  displayFieldVerifier,
  loginRoleStateConditionVerifier,
  stateClaimSupportVerifier,
  mirrorAccessVerifier,
  tenantWriteBoundaryVerifier,
];
