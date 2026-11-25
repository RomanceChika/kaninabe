/**
 * 製品の根の宣言の検査(P 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `PRODUCT_STEPS` を上から回すだけである。並びは**違反の並び**を決める。
 * ID は各検証器のファイルが持つ ID の定数を参照する。全検査の表(`lib/compose/all-checks.ts`)は `PRODUCT_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { P0_VERIFIER_ID } from '../model/product/loader.js';
import { P1_VERIFIER_ID, verifyDeclaredRoots } from './verifiers/p1-declared-roots.js';
import { P2_VERIFIER_ID, verifyDeclaredUses, type DeclaredUsesInput } from './verifiers/p2-declared-uses.js';

/** 実行の段 1 つ(検査 1 本)。 */
export interface ProductStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: DeclaredUsesInput): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const PRODUCT_STEPS: readonly ProductStep[] = [
  { id: P1_VERIFIER_ID, title: '根は製品が宣言する(宣言が実在し、宣言した根が実在する)', run: (i) => verifyDeclaredRoots(i) },
  { id: P2_VERIFIER_ID, title: '採る仕様の種類(uses)の宣言と、仕様の置き場の突合', run: (i) => verifyDeclaredUses(i) },
];

/** P 群の全検査(ローダーの P0 を含む。全検査の表が読む)。 */
export const PRODUCT_CHECKS: readonly CheckEntry[] = [
  { id: P0_VERIFIER_ID, title: 'product.md のスキーマ適合(ローダーが実施)' },
  ...PRODUCT_STEPS,
];
