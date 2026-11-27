/**
 * A6 テスト突合チェック(仕様 → テストの方向)。
 *
 * action-spec-writing.md の A6:「`test_cases[].implementation` が実在し、テスト側の `@tc` と
 * 双方向に一致する」。この方向で見るのは「仕様が守ると宣言したものが、実際にテストとして
 * 存在するか」(= uncovered の検出)であり、逆方向(orphan・テスト側の重複)は a6-orphans.ts が担う。
 *
 * 3 段の突合そのもの(ファイルの実在 → `@tc` の存在 → テスト名の一致)は
 * query_spec の Q6 と共通の規則なので、test-trace-match.ts に置いてある。
 * 突合する宣言はテストケース ID 台帳の `action_spec` エントリから引く(lib/spec-index)。
 */

import type { PartialInputTraceVerifier, PartialRun } from '../verifier.js';
import { dataTablesGap, type TraceInput } from '../input.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import { checkTestSide } from './a6-orphans.js';

/** A6: 仕様のテストケースとテストコードの `@tc` が双方向に一致するかを検証する。 */
export const testTraceVerifier: PartialInputTraceVerifier = {
  id: 'A6',
  title: 'テスト突合 — test_cases とテストの @tc が双方向に一致する',

  verify: (input) => testTraceRun(input).findings,
  runPartial: testTraceRun,
};

/**
 * 検査の本体。読めずに落とした表(テーブル仕様が「仕様を落とした」阻害)の名前空間の `@tc` は orphan と判定せず、
 * 見ていないことを `gaps` で返す(落とした表の test_cases は台帳に載らないので、台帳に無いことは「宣言が無い」を意味しない)。
 */
function testTraceRun(input: TraceInput): PartialRun {
  if (!input.tests.available) return { findings: [], gaps: [] };
  const byTcId = groupByTcId(input.tests.annotations);
  const testFiles = new Set(input.tests.testFiles);
  const findings = input.registry
    .ofKind('action_spec')
    .flatMap((entry) => checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, 'A6', { kind: 'action', id: entry.specId }));
  const side = checkTestSide(input, byTcId);
  const gap =
    side.unseen.length === 0
      ? null
      : dataTablesGap(input, '読めずに落とした表の名前空間の @tc に、宣言が無いか(orphan)は見ていません(その表の test_cases は台帳に載らない)', side.unseen);
  return { findings: [...findings, ...side.findings], gaps: gap === null ? [] : [gap] };
}
