/**
 * Z1 テスト突合チェック(保証台帳 ⇔ テスト)。
 *
 * guarantee-spec-writing.md の要求:「`test_cases[].implementation` が実在し、テスト側の
 * `@tc` と一致する」。3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の一致)は
 * A6 / Q6 / H3 とまったく同じ規則なので lib/testcase/test-trace-match.ts を共用し、突合する
 * 宣言はテストケース ID 台帳の `guarantee_spec` エントリから引く。
 *
 * **なぜこれが要るのか。** 見張りテストの実在(`canaries` が `test_cases` の id を指していること)
 * と孤児の不在は Z0 が 1 ファイルの中で閉じて見ているが、「その test_cases が本当に実装の
 * テストとして存在するか」は app/ を見ないと分からない。ここが抜けると
 * 「宣言はあるがテストは無い(削除された)」保証が緑のまま残る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { TcRegistry, TcRegistryEntry, TestAnnotation } from '../../testcase/types.js';
import type { ScanWithFramework } from '../../testcase/index.js';
import { checkTestCaseTrace, groupByTcId, ownerOf } from '../../testcase/index.js';
import { isUnderFrameworkTestRoots } from '../../io/framework-paths.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';
import { GUARANTEE_CATALOG_ID } from '../../model/guarantee/namespace.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'Z1';

/** 突合先の走査の見え方(テストファイルの集合と、`@tc` でまとめた注釈)。 */
interface ScanView {
  readonly files: ReadonlySet<string>;
  readonly byTcId: ReadonlyMap<string, readonly TestAnnotation[]>;
}

/**
 * 保証台帳の test_cases が実在するテストに接地し、`spec_ids` が実在するかを検証する。
 *
 * 見るのは**製品の台帳のエントリ**だけである(仕組みの台帳のエントリは Z3 が見る)。`@tc` の突合は app/ を走査できていない構成では
 * 何も見ない(A6 / H3 と同じ扱い)が、`spec_ids` の実在は仕様だけで判定できるので常に見る。製品の台帳が仕組みの見張りテストの
 * 置き場の下を指すエントリは、製品の走査(その置き場を読まない)ではなく**仕組みの走査**を引いて見る
 * (仕組みの走査が使えないとき — 根を渡していない・阻害 — は Z3 が言うので、ここでは見ない)。
 *
 * @param domain 構築済みのドメイン仕様モデル(spec_ids の母集合)
 * @param registry テストケース ID 台帳
 * @param tests app/ の走査結果(仕組みの根の走査を入れ子で持っていてよい)
 * @returns 違反のリスト
 */
export function verifyGuaranteeTestTrace(
  domain: SpecModel,
  registry: TcRegistry,
  tests: ScanWithFramework,
): Finding[] {
  const entries = registry.ofKind('guarantee_spec').filter((entry) => ownerOf(entry) === 'product');
  const known = new Set([...collectDomainSpecIds(domain), GUARANTEE_CATALOG_ID]);
  const findings = entries.flatMap((entry) => checkSpecIds(entry, known));
  const product: ScanView | null = tests.available
    ? { files: new Set(tests.testFiles), byTcId: groupByTcId(tests.annotations) }
    : null;
  const framework = frameworkView(tests);
  return [
    ...findings,
    ...entries.flatMap((entry) => {
      const view = isUnderFrameworkTestRoots(entry.implementation.file) ? framework : product;
      return view === null ? [] : checkTestCaseTrace(entry, view.byTcId.get(entry.tcId) ?? [], view.files, VERIFIER_ID);
    }),
  ];
}

/**
 * 仕組みの走査の見え方。使えないとき(根を渡していない・阻害)は `null` —— 突合先が無いので何も見ない
 * (Z3 が未実施 / 阻害を言う。製品の走査は仕組みの置き場を読まないので、そちらで「ファイルが無い」と偽らない)。
 */
function frameworkView(tests: ScanWithFramework): ScanView | null {
  const scan = tests.framework;
  if (scan === undefined || scan.state.state !== 'scanned') return null;
  return { files: new Set(scan.testFiles), byTcId: groupByTcId(scan.annotations) };
}

/** spec_ids が実在する仕様を指しているか(A8 / H3 と同じ役目)。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
      location: entry.location,
      suggestion: `spec_ids に書けるのはドメインの仕様 ID か、この仕様自身の id(${GUARANTEE_CATALOG_ID})である。実在する ID に直す`,
      counterexample: { test_case: entry.tcId, spec_id: id },
    }));
}
