/**
 * ルール文書の整合検査(M0〜M6)の登録。
 *
 * M0(走査範囲)は実行口が実施し、登録配列(`verifiers/index.ts`)には現れない。M1(フロントマターが読めない・無い)はローダーが
 * 積むが、同じ ID の検査が登録配列にもある。ここでは M0 と登録配列(`ALL_DOC_VERIFIERS`)を束ねる。
 * 全検査の表(`lib/compose/all-checks.ts`)は `DOC_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { SCOPE_VERIFIER_ID } from './run.js';
import { ALL_DOC_VERIFIERS } from './verifiers/index.js';

/** M0〜M6 の全検査(全検査の表が読む)。 */
export const DOC_CHECKS: readonly CheckEntry[] = [
  { id: SCOPE_VERIFIER_ID, title: '走査対象の文書が 1 件以上ある(走査範囲が黙って狭まらない)' },
  ...ALL_DOC_VERIFIERS,
];
