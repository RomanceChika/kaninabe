/**
 * query_spec の検査(Q 群)の登録。
 *
 * Q0(スキーマ適合)はモデル構築と不可分なのでローダーが実施し、登録配列(`verifiers/index.ts`)には現れない。ここでは
 * ローダーの Q0 と登録配列(`ALL_QUERY_VERIFIERS`)を束ねる。全検査の表(`lib/compose/all-checks.ts`)は `QUERY_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { Q0_VERIFIER_ID } from '../model/query/loader.js';
import { ALL_QUERY_VERIFIERS } from './verifiers/index.js';

/** Q 群の全検査(全検査の表が読む)。 */
export const QUERY_CHECKS: readonly CheckEntry[] = [
  { id: Q0_VERIFIER_ID, title: 'query_spec のスキーマ適合(モデル構築と不可分。ローダーが実施)' },
  ...ALL_QUERY_VERIFIERS,
];
