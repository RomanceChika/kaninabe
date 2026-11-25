/**
 * A13 テストケースの直接性 — `source: schedule` / `manual` のジョブは直接のテストケースが必須。
 *
 * 帰属規則(束⑪a。L2 網羅台帳「ジョブ」の証拠の導出規則と対になる)は 3 段に分かれる。
 *   (a) ジョブ ID が通知カタログにも載っている(= 通知として送るジョブ)なら、
 *       その通知と同じ証拠(遷移由来 + notification-catalog の test_cases)を使う。
 *   (b) `source: outbox` の非通知ジョブは、それを effects に持つ遷移の成功ケース +
 *       job-catalog の test_cases(カタログ全体の整合を確かめるテスト)を使う。
 *   (c) `source: schedule` / `manual` は遷移(effects)の裏付けが無い —— 時刻や人の
 *       ボタンが起点であり、どの state_spec からも導出できない。したがって、
 *       ジョブ自身の ID を `spec_ids` に挙げる test_cases が最低 1 つ必須になる。
 *
 * A13 が見るのは (c) だけである((a)(b) は証拠が 0 件でも「導出できる母集合が無い」という
 * 事実にすぎず、エラーにする理由が無い — L2 網羅台帳の「押さえるテストが1本も無い行」に
 * 現れるだけで足りる)。
 */

import type { Finding } from '../verifier.js';
import { catalogTraceVerifier, traceFinding } from '../verifier.js';
import type { JobCatalogSpec } from '../../model/job/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/**
 * A13: schedule / manual ジョブに直接のテストケース(spec_ids に自身の ID)が無ければエラーにする。
 *
 * ジョブカタログの入力の状態を報告する検査である(部品化 ②-b の最初の 1 本)。`jobs` を採っていなければ
 * 未実施・採ったのに渡せなければ阻害・渡せれば実行(0 件の空のカタログも実行)。
 */
export const scheduleManualJobTagsVerifier = catalogTraceVerifier<JobCatalogSpec>({
  id: 'A13',
  title: 'テストケースの直接性 — source: schedule / manual のジョブは spec_ids に自身の ID を持つ test_cases が必須',
  kind: 'jobs',
  inputOf: (input) => input.jobs,
  verifyCatalog(catalog, input): Finding[] {
    const findings: Finding[] = [];
    for (const job of catalog.jobs) {
      if (job.source === 'outbox') continue;
      const tagged = catalog.testCases.some((tc) => tc.specIds.includes(job.id));
      if (!tagged) findings.push(untaggedFinding(job.id, job.source, input.roots));
    }
    return findings;
  },
});

/** 直接のテストケースを持たない schedule / manual ジョブの Finding。 */
function untaggedFinding(jobId: string, source: string, roots: ProductRoots): Finding {
  return traceFinding('A13', {
    message: `ジョブ ${jobId}(source: ${source})は spec_ids に自身の ID を持つ test_cases がありません`,
    location: { file: specPath(roots, 'backend/jobs.md') },
    suggestion:
      `${specPath(roots, 'backend/jobs.md')} の test_cases に spec_ids: [${jobId}] を持つ行を足す` +
      '(既存の実装テストを引用してよい。schedule / manual は effects からの導出が効かないため、' +
      'この直接の宣言だけが証拠になる)',
    counterexample: { job: jobId, source },
  });
}
