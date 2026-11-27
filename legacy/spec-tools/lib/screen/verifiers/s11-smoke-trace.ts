/**
 * S11 スモーク突合チェック(screen_spec の `smoke:` ⇔ app/e2e/*.spec.mts)。
 *
 * screen-spec-writing.md の S11:「`smoke[].implementation` が指す `{file}::{テスト名}` が、
 * 走査結果(`@tc` アノテーション)の中に実在すること」。
 *
 * `test_cases`(S8)との違いは、ここが**テストケース ID 台帳を経由しない**ことである。
 * E2E スモークは 1 本の貫通シナリオが多数の画面をまたぐため(screen-test.md §E2E スモーク)、
 * 「1 テストケース ID = 1 画面」を前提にした台帳(A6/A9)には「正の登録を担う 1 画面」の
 * `test_cases` だけが乗る(実例: `workshop_detail` の TC-SCREEN-WORKSHOP_DETAIL-019)。
 * 他の画面の `smoke:` は同じテスト(`{file}::{テスト名}` の組)を指すだけで、
 * 自分のテストケース ID を持たない――だからこそ、突合の母集合は台帳ではなく
 * 走査結果の生アノテーション(`input.tests.annotations`)そのものにする。
 *
 * 実在確認だけを行い、`@tc` の ID・`@spec` の内容までは突き合わせない
 * (それは正の登録を担う画面側で S8 が既に見ている)。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import { absentFor } from '../../kernel/scope-owner.js';
import type { ScreenInput } from '../../model/screen/types.js';
import type { ScreenSmoke } from '../../model/screen/types.js';

/** S11: screen_spec の smoke が実在する E2E スペックのテストに接地しているかを検証する。 */
export const smokeTraceVerifier: ScreenVerifier = {
  id: 'S11',
  title: 'スモーク突合 — smoke の implementation が実在する E2E テストに一致する',

  verify(input: ScreenInput): Finding[] {
    // app/ を走査できていない環境(仕様だけのリポジトリ)では判断材料が無い(S8 と同じ扱い)。
    if (!input.tests.available) return [];
    const testFiles = new Set(input.tests.testFiles);
    const resolved = new Set(
      input.tests.annotations
        .filter((annotation) => annotation.testName !== null)
        .map((annotation) => `${annotation.file}::${annotation.testName}`),
    );

    const findings: Finding[] = [];
    for (const screen of input.screens.screens) {
      for (const entry of screen.smoke) {
        findings.push(...checkEntry(screen.id, entry, testFiles, resolved));
      }
    }
    return findings;
  },
};

function checkEntry(
  screenId: string,
  entry: ScreenSmoke,
  testFiles: ReadonlySet<string>,
  resolved: ReadonlySet<string>,
): Finding[] {
  const { file, testName, raw } = entry.implementation;
  if (!testFiles.has(file)) {
    const missing = screenFinding('S11', {
      message: `${screenId} の smoke の implementation が指すファイル(${file})がありません`,
      location: entry.location,
      suggestion: `${file} を作るか、implementation のパスを実在する app/e2e/*.spec.mts へ直す`,
      counterexample: { screen: screenId, implementation: raw },
    });
    return [absentFor({ kind: 'screen', id: screenId }, missing)];
  }
  const key = `${file}::${testName}`;
  if (!resolved.has(key)) {
    return [
      screenFinding('S11', {
        message: `${screenId} の smoke の implementation(${raw})に対応するテストが見つかりません`,
        location: entry.location,
        suggestion:
          `${file} の "${testName}" というテストの直前に "// @spec {仕様ID...} @tc {テストケースID}" ` +
          'の注釈を付ける(注釈は 1 本の物理テストにつき 1 つだけ置ける。既に別の画面の smoke / ' +
          'test_cases が同じテストを指しているなら implementation のテスト名を揃える)',
        counterexample: { screen: screenId, implementation: raw },
      }),
    ];
  }
  return [];
}
