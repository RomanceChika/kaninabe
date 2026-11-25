/**
 * H3 テスト突合チェック(認証フロー仕様 ⇔ テスト)。
 *
 * auth-spec-writing.md の要求:「`test_cases[].implementation` が実在し、テスト側の `@tc` と
 * 一致する」。3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の一致)は A6 / Q6 / S8 と
 * まったく同じ規則なので lib/testcase/test-trace-match.ts を共用し、突合する宣言は
 * テストケース ID 台帳の `auth_spec` エントリから引く。
 *
 * **なぜこれが要るのか。** 認証フロー仕様の宣言は「サインインの分岐」という**実装の中の
 * 出来事**であり、画面や DB のように外から観測できるものが少ない。宣言だけがあってテストが
 * 消えても誰も気づかない状態を作らないために、宣言 ⇔ テストの側を機械で閉じる
 * (宣言 ⇔ 実装の側は生成物 `SIGN_IN_BRANCHES` を回す app 側のテストが閉じる)。
 * 逆方向(テストにあるが仕様に無い `@tc`)は A6 が、ID の一意性は A9 が、同じ台帳を
 * 母集合にして見るため、ここでは重ねて実装しない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { TestScanResult, TcRegistry, TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';
import { AUTH_FLOW_ID } from '../../model/auth/parse-auth.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H3';

/**
 * 認証フロー仕様の test_cases が実在するテストに接地し、`spec_ids` が実在するかを検証する。
 *
 * `@tc` の突合は app/ を走査できていない構成では何も見ない(A6 / S8 と同じ扱い)が、
 * `spec_ids` の実在は仕様だけで判定できるので常に見る。
 *
 * @param domain 構築済みのドメイン仕様モデル(spec_ids の母集合)
 * @param registry テストケース ID 台帳
 * @param tests app/ の走査結果
 * @returns 違反のリスト
 */
export function verifyAuthTestTrace(
  domain: SpecModel,
  registry: TcRegistry,
  tests: TestScanResult,
): Finding[] {
  const entries = registry.ofKind('auth_spec');
  const known = new Set([...collectDomainSpecIds(domain), AUTH_FLOW_ID]);
  const findings = entries.flatMap((entry) => checkSpecIds(entry, known));
  if (!tests.available) return findings;
  const byTcId = groupByTcId(tests.annotations);
  const testFiles = new Set(tests.testFiles);
  return [
    ...findings,
    ...entries.flatMap((entry) =>
      checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, VERIFIER_ID),
    ),
  ];
}

/** spec_ids が実在する仕様を指しているか(A8 / S8 と同じ役目)。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
      location: entry.location,
      suggestion: `spec_ids に書けるのはドメインの仕様 ID か、この仕様自身の id(${AUTH_FLOW_ID})である。実在する ID に直す`,
      counterexample: { test_case: entry.tcId, spec_id: id },
    }));
}
