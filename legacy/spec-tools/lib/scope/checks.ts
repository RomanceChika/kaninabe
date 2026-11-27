/**
 * 実装の範囲の検査(P13・P14)の登録。全検査の表(`lib/compose/all-checks.ts`)は `SCOPE_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { P13_VERIFIER_ID } from './verifiers/p13-implemented-ids.js';
import { P14_VERIFIER_ID } from './verifiers/p14-narrowing.js';

/** 範囲の検査(全検査の表が読む)。 */
export const SCOPE_CHECKS: readonly CheckEntry[] = [
  { id: P13_VERIFIER_ID, title: 'implemented の id が、実装の範囲に入れられる仕様の id である' },
  { id: P14_VERIFIER_ID, title: '実装の範囲が広がる向きにしか動かない(base の宣言と比べる)' },
];
