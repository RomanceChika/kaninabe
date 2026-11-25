/**
 * 画面仕様の検査(S 群)の登録。
 *
 * S0(screen_spec / chrome_spec のスキーマ適合)はモデル構築と不可分なのでローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。
 * ここではローダーの S0 と登録配列(`ALL_SCREEN_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `SCREEN_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { S0_VERIFIER_ID } from '../model/screen/loader.js';
import { ALL_SCREEN_VERIFIERS } from './verifiers/index.js';

/** S 群の全検査(全検査の表が読む)。 */
export const SCREEN_CHECKS: readonly CheckEntry[] = [
  { id: S0_VERIFIER_ID, title: 'screen_spec / chrome_spec のスキーマ適合(モデル構築と不可分。ローダーが実施)' },
  ...ALL_SCREEN_VERIFIERS,
];
