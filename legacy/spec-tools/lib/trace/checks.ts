/**
 * action_spec の検査(A 群)の登録。
 *
 * A0(スキーマ適合)はモデル構築と不可分なのでローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。ここでは
 * ローダーの A0 と登録配列(`ALL_TRACE_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `TRACE_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { A0_VERIFIER_ID } from '../model/trace/loader.js';
import { ALL_TRACE_VERIFIERS } from './verifiers/index.js';

/** A 群(action_spec)の全検査(全検査の表が読む)。 */
export const TRACE_CHECKS: readonly CheckEntry[] = [
  { id: A0_VERIFIER_ID, title: 'action_spec のスキーマ適合(モデル構築と不可分。ローダーが実施)' },
  ...ALL_TRACE_VERIFIERS,
];
