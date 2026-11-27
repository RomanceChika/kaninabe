/**
 * S8 テスト突合チェック(画面仕様 ⇔ screenTest)。
 *
 * screen-spec-writing.md の S8:「`test_cases[].implementation` が実在し、テスト側の `@tc` と
 * 双方向に一致し、`spec_ids` が実在する」。
 *
 * 3 段の突合そのもの(ファイルの実在 → `@tc` の存在 → テスト名の一致)は A6 / Q6 と
 * 完全に同じ規則なので lib/testcase/test-trace-match.ts を共用し、突合する宣言は
 * テストケース ID 台帳の `screen_spec` エントリから引く(lib/testcase/registry.ts)。
 * 逆方向(テストにあるが仕様に無い `@tc` = orphan)は A6 が、ID の一意性は A9 が、
 * どちらも同じ台帳を母集合にして見るため、ここでは重ねて実装しない。
 *
 * **`type: integration` を要求しない**のが Q6 との違いである。画面が守っているのは配線
 * (何が描かれ、どこへ出られるか)であり、それは偽のクエリ結果を渡した関数呼び出しで
 * 確かめきれる。実 DB を通しても確かめられることは 1 つも増えない
 * (増えるのは読み取りの可視性で、それは query_spec 側の Q6 が既に要求している)。
 */

import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding } from '../verifier.js';
import type { TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import type { ScreenInput } from '../../model/screen/types.js';
import { collectScreenSpecIds } from '../spec-ids.js';

/** S8: screen_spec の test_cases が実在する screenTest に接地しているかを検証する。 */
export const testTraceVerifier: ScreenVerifier = {
  id: 'S8',
  title: 'テスト突合 — test_cases と screenTest の @tc が一致し、spec_ids が実在する',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    // spec_ids の値域には query_spec の id が入る。query_spec が阻害なら、欠けた値域で「仕様がありません」と言わない(行は呼び手が言う)。
    const findings = foreignBlocked(ctx, 'queries') ? [] : specIdFindings(input);
    return [...findings, ...matchAnnotations(input)];
  },
};

/** spec_ids が実在する仕様を指しているか(台帳の screen_spec の宣言ごと)。 */
function specIdFindings(input: ScreenInput): Finding[] {
  const known = collectScreenSpecIds(input.domain, input.queries, input.screens);
  return input.registry.ofKind('screen_spec').flatMap((entry) => checkSpecIds(entry, known));
}

/** 仕様 → テストの 3 段突合(app/ を走査できているときだけ)。 */
function matchAnnotations(input: ScreenInput): Finding[] {
  if (!input.tests.available) return [];
  const byTcId = groupByTcId(input.tests.annotations);
  const testFiles = new Set(input.tests.testFiles);
  return input.registry
    .ofKind('screen_spec')
    .flatMap((entry) => checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, 'S8', { kind: 'screen', id: entry.specId }));
}

/** spec_ids が実在する仕様を指しているか。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) =>
      screenFinding('S8', {
        message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
        location: entry.location,
        suggestion:
          `spec_ids に書けるのは screen_spec の id(${entry.specId})・chrome_spec の id・` +
          'query_spec の id・ドメインイベント ID のいずれか。実在する ID に直す' +
          '(可視性と不変条件を守っているのは RLS と DB 制約であり、画面テストからは確かめられないので書かない)',
        counterexample: { screen: entry.specId, test_case: entry.tcId, spec_id: id },
      }),
    );
}
