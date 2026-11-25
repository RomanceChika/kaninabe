/**
 * 視覚層の検査(G 群)の登録。
 *
 * G0(トークン仕様のスキーマ適合)はローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。ここではローダーの G0 と
 * 登録配列(`ALL_DESIGN_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `DESIGN_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { G0_VERIFIER_ID } from '../model/design/loader.js';
import { ALL_DESIGN_VERIFIERS } from './verifiers/index.js';

/** G 群の全検査(全検査の表が読む)。 */
export const DESIGN_CHECKS: readonly CheckEntry[] = [
  { id: G0_VERIFIER_ID, title: 'トークン仕様のスキーマ適合(ローダーが実施)' },
  ...ALL_DESIGN_VERIFIERS,
];
