/**
 * UX 原則の台帳(`ux-principles.md`)の検査の登録。全検査の表(`lib/compose/all-checks.ts`)は `UX_PRINCIPLES_CHECKS` を読む。
 */

import { type CheckEntry } from '../kernel/check-entry.js';
import { U8_VERIFIER_ID } from '../model/ux-principles/loader.js';

/** UX 原則の台帳の全検査(全検査の表が読む)。 */
export const UX_PRINCIPLES_CHECKS: readonly CheckEntry[] = [{ id: U8_VERIFIER_ID, title: 'UX 原則の台帳の整合(閾値・受け入れの形。ローダーが実施)' }];
