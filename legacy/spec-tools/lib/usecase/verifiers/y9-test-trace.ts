/**
 * Y9 テスト突合チェック(usecase_spec ⇔ テスト)。
 *
 * usecase-spec-writing.md の要求:「保存点ごとに、複合 RPC の**署名の実在**と**本文の一致**を
 * 見るテストケースを宣言し、`test_cases[].implementation` が実在するテストの `@tc` と
 * 一致すること」。3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の一致)は
 * A6 / Q6 / Z1 とまったく同じ規則なので lib/testcase/test-trace-match.ts を共用する。
 *
 * **なぜこれが要るのか。** 複合 RPC は生成物であり、生成の鮮度は `generate:check` が見る。
 * だが「生成した SQL が実 DB に適用されているか」は app/ の統合テストにしか分からない。
 * 注釈(`@tc`)が無いと、migration を作ったが適用していない状態が緑のまま残る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';
import type { UsecaseInput } from '../derive.js';
import { usecaseFinding, type UsecaseContext, type UsecaseVerifier } from '../verifier.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'Y9';

/** 保存点 1 つにつき最低限要るテストケースの数(署名の実在 + 本文の一致)。 */
const REQUIRED_PER_SAVE = 2;

/** Y9 の実装。 */
export const testTraceVerifier: UsecaseVerifier = {
  id: VERIFIER_ID,
  title: 'ユースケース仕様 ⇔ テストの突合(保存点ごとの注釈)',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    const findings = input.usecases.usecases.flatMap((usecase) => checkCount(usecase.testCases.length, usecase));
    const registry = ctx.registry;
    if (registry === undefined) return findings;
    const entries = registry.ofKind('usecase_spec');
    const known = new Set([
      ...collectDomainSpecIds(input.domain),
      ...input.usecases.usecases.map((usecase) => usecase.id),
    ]);
    findings.push(...entries.flatMap((entry) => checkSpecIds(entry, known)));
    const tests = ctx.tests;
    if (tests === undefined || !tests.available) return findings;
    const byTcId = groupByTcId(tests.annotations);
    const testFiles = new Set(tests.testFiles);
    return [
      ...findings,
      ...entries.flatMap((entry) => checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, VERIFIER_ID, { kind: 'usecase', id: entry.specId })),
    ];
  },
};

/** 保存点の数に対してテストケースが足りているか(署名 + 本文の 2 本 × 保存点)。 */
function checkCount(
  declared: number,
  usecase: { readonly name: string; readonly saves: readonly unknown[]; readonly location: { readonly file: string } },
): Finding[] {
  const required = usecase.saves.length * REQUIRED_PER_SAVE;
  if (declared >= required) return [];
  return [
    usecaseFinding(VERIFIER_ID, {
      message: `${usecase.name} の test_cases が ${declared} 件しかありません(保存点 ${usecase.saves.length} 件には ${required} 件が要ります)`,
      location: { file: usecase.location.file, pointer: 'test_cases' },
      suggestion:
        '保存点ごとに「複合 RPC が宣言どおりの署名で実在する」「本文が生成した SQL と一致する」の' +
        '2 件を usecase-rpc-parity.test.ts に足し、そのテストケースをここに宣言する',
      counterexample: { usecase: usecase.name, declared: String(declared), required: String(required) },
    }),
  ];
}

/** spec_ids が実在する仕様(ドメインの ID か、ユースケース自身の id)を指しているか。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) =>
      usecaseFinding(VERIFIER_ID, {
        message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
        location: entry.location,
        suggestion: 'spec_ids に書けるのはドメインの仕様 ID か、このユースケース自身の id である。実在する ID に直す',
        counterexample: { test_case: entry.tcId, spec_id: id },
      }),
    );
}
