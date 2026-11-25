/**
 * ドメイン仕様の検査(V 群)の登録。
 *
 * V1(スキーマ適合)はモデル構築と不可分なのでローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。ここでは
 * ローダーの V1 と登録配列(`ALL_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `DOMAIN_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { V1_VERIFIER_ID } from '../model/parse-common.js';
import { ALL_VERIFIERS } from './verifiers/index.js';

/** V 群の全検査(全検査の表が読む)。 */
export const DOMAIN_CHECKS: readonly CheckEntry[] = [
  { id: V1_VERIFIER_ID, title: 'ドメイン仕様のスキーマ適合(モデル構築と不可分。ローダーが実施)' },
  ...ALL_VERIFIERS,
];
