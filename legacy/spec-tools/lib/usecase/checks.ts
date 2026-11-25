/**
 * usecase_spec の検査(Y 群)の登録。
 *
 * Y0(スキーマ適合)はモデル構築と不可分なのでローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。ここでは
 * ローダーの Y0 と登録配列(`ALL_USECASE_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `USECASE_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { Y0_VERIFIER_ID } from '../model/usecase/loader.js';
import { ALL_USECASE_VERIFIERS } from './verifiers/index.js';

/** Y 群の全検査(全検査の表が読む)。 */
export const USECASE_CHECKS: readonly CheckEntry[] = [
  { id: Y0_VERIFIER_ID, title: 'usecase_spec のスキーマ適合(モデル構築と不可分。ローダーが実施)' },
  ...ALL_USECASE_VERIFIERS,
];
