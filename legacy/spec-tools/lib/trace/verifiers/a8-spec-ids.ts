/**
 * A8 `spec_ids` の実在チェック。
 *
 * action-spec-writing.md の A8:「`test_cases[].spec_ids` が実在する仕様 ID を指す」。
 *
 * `spec_ids` は「このテストが何を守っているか」の宣言である。指す先が存在しなければ、
 * テストは何も守っていないのに**守っているように読める**(綴り違い・イベント名の改名・
 * 不変条件の削除で静かにそうなる)。A7 の意味的カバレッジも `spec_ids` を手がかりにする以上、
 * 接地していない宣言は体系全体の判断を甘くする。
 *
 * 値域の定義は lib/semantics/domain-spec-ids.ts が持ち、読み取り側の Q6 と共有している
 * (同じ規則を 2 か所に書かないため)。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { TraceInput } from '../input.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';

/** A8: test_cases の spec_ids がドメイン仕様に接地しているかを検証する。 */
export const specIdGroundingVerifier: TraceVerifier = {
  id: 'A8',
  title: 'spec_ids の実在 — テストが守ると宣言した仕様 ID が実在する',

  verify(input: TraceInput): Finding[] {
    const known = collectDomainSpecIds(input.domain);
    return input.actions.actions.flatMap((action) =>
      action.testCases.flatMap((testCase) => checkTestCase(action, testCase, known)),
    );
  },
};

/** そのエンティティで書き得る予約 ID の並び(助言に載せる候補)。 */
function reservedIdsFor(entity: string): string {
  return ['create', 'delete', 'update'].map((op) => `${entity}.${op}`).join(' / ');
}

/** 1 件のテストケースの spec_ids を突き合わせる。 */
function checkTestCase(
  action: ActionSpec,
  testCase: ActionTestCase,
  known: ReadonlySet<string>,
): Finding[] {
  return testCase.specIds
    .filter((id) => !known.has(id))
    .map((id) =>
      traceFinding('A8', {
        message: `${testCase.id} の spec_ids ${id} に対応する仕様がありません`,
        location: testCase.location,
        suggestion:
          `spec_ids に書けるのはドメインイベント ID(この action_spec なら ${action.handles.raw})・` +
          `予約 ID(${reservedIdsFor(action.handles.machine)})・access_spec の id・不変条件 ID の` +
          'いずれか。実在する ID に直すか、指したい仕様を specs/domain に先に足す' +
          '(予約 ID は access_spec に creates / deletes / writes の宣言があるものだけ実在する)',
        counterexample: { action: action.id, test_case: testCase.id, spec_id: id },
      }),
    );
}
