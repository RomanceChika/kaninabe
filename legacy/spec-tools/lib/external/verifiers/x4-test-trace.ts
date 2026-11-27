/**
 * X4 テスト突合チェック(外部連携カタログ ⇔ テスト)。
 *
 * external-spec-writing.md の要求:「`test_cases[].implementation` が実在し、テスト側の
 * `@tc` と一致する(書けば。任意)」。3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の
 * 一致)は Z1 / H3 とまったく同じ規則なので lib/testcase/test-trace-match.ts を共用し、突合する
 * 宣言はテストケース ID 台帳の `external_spec` エントリから引く(H3 と同型)。
 *
 * `test_cases` は他のカタログと違い任意(0 件でもよい)。0 件のときは登録するエントリ自体が
 * 無いので、この検証器は自然に何も見ない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { TestScanResult, TcRegistry, TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';
import { EXTERNAL_CATALOG_ID } from '../../model/external/parse-external.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X4';

/**
 * 外部連携カタログの test_cases が実在するテストに接地し、`spec_ids` が実在するかを検証する。
 *
 * `@tc` の突合は app/ を走査できていない構成では何も見ない(Z1 / H3 と同じ扱い)が、
 * `spec_ids` の実在は仕様だけで判定できるので常に見る。
 *
 * @param domain 構築済みのドメイン仕様モデル(spec_ids の母集合)
 * @param registry テストケース ID 台帳
 * @param tests app/ の走査結果
 * @returns 違反のリスト
 */
export function verifyExternalTestTrace(
  domain: SpecModel,
  registry: TcRegistry,
  tests: TestScanResult,
): Finding[] {
  const entries = registry.ofKind('external_spec');
  const known = new Set([...collectDomainSpecIds(domain), EXTERNAL_CATALOG_ID]);
  const findings = entries.flatMap((entry) => checkSpecIds(entry, known));
  if (!tests.available) return findings;
  const byTcId = groupByTcId(tests.annotations);
  const testFiles = new Set(tests.testFiles);
  return [
    ...findings,
    ...entries.flatMap((entry) =>
      checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, VERIFIER_ID, { kind: 'catalog', id: EXTERNAL_CATALOG_ID }),
    ),
  ];
}

/** spec_ids が実在する仕様を指しているか(A8 / H3 / Z1 と同じ役目)。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
      location: entry.location,
      suggestion: `spec_ids に書けるのはドメインの仕様 ID か、この仕様自身の id(${EXTERNAL_CATALOG_ID})である。実在する ID に直す`,
      counterexample: { test_case: entry.tcId, spec_id: id },
    }));
}
