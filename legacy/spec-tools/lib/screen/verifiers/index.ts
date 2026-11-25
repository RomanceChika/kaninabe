/**
 * 画面検証器レジストリ。
 *
 * 新しい検証器の追加は「ScreenVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * S0(screen_spec / chrome_spec のスキーマ適合)はモデル構築と不可分なため lib/model/screen/loader.ts 内で
 * 実施され、この一覧には現れない(V1 / A0 / Q0 と同じ扱い)。
 */

import type { ScreenVerifier } from '../verifier.js';
import { routeVerifier } from './s1-route.js';
import { referenceExistenceVerifier } from './s2-reference-existence.js';
import { reachabilityVerifier } from './s3-reachability.js';
import { roleConsistencyVerifier } from './s4-role-consistency.js';
import { preconditionVerifier } from './s5-precondition.js';
import { layoutVerifier } from './s6-layout.js';
import { implementationRoutesVerifier } from './s7-implementation-routes.js';
import { testTraceVerifier } from './s8-test-trace.js';
import { testPresenceVerifier } from './s9-test-presence.js';
import { domainExposureVerifier } from './s10-domain-exposure.js';
import { smokeTraceVerifier } from './s11-smoke-trace.js';
import { errorReachabilityVerifier } from './s12-error-reachability.js';
import { roleStateReachVerifier } from './s13-role-state-reach.js';
import { stateVisibilityVerifier } from './s14-state-visibility.js';
import { transitionLandingVerifier } from './s15-transition-landing.js';
import { usecaseExposureVerifier } from './s16-usecase-exposure.js';
import { formComponentVerifier } from './s17-form-component.js';
import { readComponentVerifier } from './s18-read-component.js';
import { operationComponentVerifier } from './s19-operation-component.js';
import { platformOpVerifier } from './s20-platform-op.js';
import { platformOpExposureVerifier } from './s21-platform-op-exposure.js';
import { previewFragmentsVerifier } from './s22-preview-fragments.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_SCREEN_VERIFIERS: readonly ScreenVerifier[] = [
  routeVerifier,
  referenceExistenceVerifier,
  reachabilityVerifier,
  roleConsistencyVerifier,
  preconditionVerifier,
  layoutVerifier,
  implementationRoutesVerifier,
  testTraceVerifier,
  testPresenceVerifier,
  domainExposureVerifier,
  smokeTraceVerifier,
  errorReachabilityVerifier,
  roleStateReachVerifier,
  stateVisibilityVerifier,
  transitionLandingVerifier,
  usecaseExposureVerifier,
  formComponentVerifier,
  readComponentVerifier,
  operationComponentVerifier,
  platformOpVerifier,
  platformOpExposureVerifier,
  previewFragmentsVerifier,
];
