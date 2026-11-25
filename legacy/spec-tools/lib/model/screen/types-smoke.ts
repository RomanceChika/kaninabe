/**
 * `smoke:`(E2E スモークがこの画面を通ることの宣言)の型。
 *
 * 責務は「1 画面の `smoke:` 節」に閉じる(画面全体の型は types.ts が持つ)。
 * パーサーは parse-screen-smoke.ts、実在検査は S11(verifiers/s11-smoke-trace.ts)。
 */

import type { SourceLocation } from '../types.js';
import type { TestImplRef } from '../../testcase/types.js';

/**
 * E2E スモークがこの画面を通ることの宣言(`smoke:`。任意。2026-09-04 拡張)。
 *
 * `test_cases` とは別の、軽い受け皿である。E2E スモークは 1 本の貫通シナリオが多数の画面を
 * またぐため(screen-test.md §E2E スモーク)、「1 テストケース ID = 1 画面」を前提にした
 * `test_cases`(テストケース ID 台帳に正として登録する側)には乗らない。**正の登録は
 * どれか 1 画面の `test_cases` が担い**(実例: `workshop_detail` の TC-SCREEN-WORKSHOP_DETAIL-019)、
 * 他の画面の `smoke:` は同じテスト(`implementation` の file::テスト名の組)を指すだけで、
 * 自分のテストケース ID は持たない。実在は S11 が
 * (`app/e2e/*.spec.mts` を含む走査結果の `@tc` アノテーションと)突き合わせる。
 */
export interface ScreenSmoke {
  /** この画面を通る手順の要約(日本語 1〜2 行)。 */
  readonly summary: string;
  /** `{app/e2e/*.spec.mts のパス}::{テスト名}`。 */
  readonly implementation: TestImplRef;
  readonly location: SourceLocation;
}
