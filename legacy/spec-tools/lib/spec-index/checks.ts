/**
 * テストケース ID の台帳の検査(A9)の登録。全検査の表(`lib/compose/all-checks.ts`)は `SPEC_INDEX_CHECKS` を読む。
 */

import type { CheckEntry } from '../kernel/check-entry.js';
import { ALL_SPEC_INDEX_VERIFIERS } from './verifiers/index.js';

/** 台帳の全検査(全検査の表が読む)。 */
export const SPEC_INDEX_CHECKS: readonly CheckEntry[] = ALL_SPEC_INDEX_VERIFIERS;
