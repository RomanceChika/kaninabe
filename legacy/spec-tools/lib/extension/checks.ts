/**
 * 拡張候補の台帳の検査(W5)の登録。全検査の表(`lib/compose/all-checks.ts`)は `EXTENSION_CHECKS` を読む。
 */

import { type CheckEntry } from '../kernel/check-entry.js';
import { EXTENSION_LEDGER_VERIFIER_ID } from '../model/extension/loader.js';

/** 拡張候補の台帳の全検査(全検査の表が読む)。 */
export const EXTENSION_CHECKS: readonly CheckEntry[] = [
  { id: EXTENSION_LEDGER_VERIFIER_ID, title: '拡張候補の台帳と、警告の実際の出方が食い違わない' },
];
