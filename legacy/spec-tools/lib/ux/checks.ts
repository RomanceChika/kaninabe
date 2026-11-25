/**
 * UX 検査(U 群)の登録。
 *
 * U0(UX の受け入れ宣言の検査)は登録配列(`verifiers/index.ts`)の外で実行口が実施する。ここでは U0 と登録配列(`ALL_UX_VERIFIERS`)を束ねる。
 * 全検査の表(`lib/compose/all-checks.ts`)は `UX_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { U0_VERIFIER_ID } from './run.js';
import { ALL_UX_VERIFIERS } from './verifiers/index.js';

/** U 群の全検査(全検査の表が読む)。 */
export const UX_CHECKS: readonly CheckEntry[] = [
  { id: U0_VERIFIER_ID, title: 'UX の受け入れ(ux:)に、指摘が出ていないもの・存在しない原則・重複がない' },
  ...ALL_UX_VERIFIERS,
];
