/**
 * job_spec(ジョブカタログ)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・語彙の既定)を引き受ける。
 */

import type { JobCatalogSpec, JobDecl, JobScheduleDecl, JobSpecModel, JobTermDecl } from '../../lib/model/job/types.js';
import type { CatalogInput } from '../../lib/kernel/input-state.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** カタログの仕様ファイル(location に使う)。 */
const CATALOG_FILE = 'docs/specs/backend/jobs.md';

/** テスト用のテストケース宣言を 1 件作る。 */
export function jobTestCase(id: string): ActionTestCase {
  return {
    id,
    type: 'unit',
    specIds: ['job-catalog'],
    covers: ['success'],
    implementation: {
      raw: 'app/src/operation/__tests__/jobs/job-catalog.test.ts::突合',
      file: 'app/src/operation/__tests__/jobs/job-catalog.test.ts',
      testName: '突合',
    },
    location: loc(CATALOG_FILE, 'test_cases[0]'),
  };
}

/** イベントで積まれるジョブ 1 本を作る。 */
export function outboxJob(id: string, opts: Partial<Omit<JobDecl, 'id' | 'location'>> = {}): JobDecl {
  return {
    id,
    source: 'outbox',
    kind: 'notification',
    onFailure: 'retry_then_dead_letter',
    summary: `${id} の説明`,
    ...opts,
    location: loc(CATALOG_FILE, `jobs.${id}`),
  };
}

/** 時刻で起きるジョブ 1 本を作る。schedule の既定は「登録済み・10 分おき」。 */
export function scheduledJob(
  id: string,
  schedule: Partial<JobScheduleDecl> = {},
  opts: Partial<Omit<JobDecl, 'id' | 'location' | 'schedule'>> = {},
): JobDecl {
  return {
    id,
    source: 'schedule',
    kind: 'scan',
    onFailure: 'skip_and_next_run',
    summary: `${id} の説明`,
    ...opts,
    schedule: {
      cron: '*/10 * * * *',
      endpoint: '/api/jobs/run',
      implementation: 'app/src/operation/jobs/run-due-jobs.ts',
      scheduler: 'host',
      ...schedule,
    },
    location: loc(CATALOG_FILE, `jobs.${id}`),
  };
}

/**
 * まだ Cron に結線していないジョブ 1 本を作る。
 *
 * `scheduledJob` に `cron: undefined` を渡す形にしないのは、`exactOptionalPropertyTypes` の下では
 * 「キーが無い」と「値が undefined」が別物だからである(免除は前者で表す)。
 */
export function notScheduledJob(id: string, reason: string, implementation?: string): JobDecl {
  return {
    id,
    source: 'schedule',
    kind: 'scan',
    onFailure: 'skip_and_next_run',
    summary: `${id} の説明`,
    schedule: {
      notScheduledReason: reason,
      implementation: implementation ?? 'app/src/operation/jobs/run-due-jobs.ts',
      scheduler: 'host',
    },
    location: loc(CATALOG_FILE, `jobs.${id}`),
  };
}

/** カタログ 1 件を作る。語彙はビルダーの既定値を全部含む(`kindTerms` を渡せば `kind` の語彙だけ差し替える)。 */
export function jobCatalog(jobs: readonly JobDecl[], kindTerms?: readonly JobTermDecl[]): JobCatalogSpec {
  return {
    id: 'job-catalog',
    vocabulary: {
      kind: kindTerms ?? [{ id: 'notification' }, { id: 'transaction_effect' }, { id: 'scan' }],
      on_failure: [
        { id: 'retry_then_dead_letter', means: 'retry_to_dead' },
        { id: 'skip_and_next_run', means: 'next_run' },
      ],
    },
    jobs,
    testCases: [jobTestCase('TC-JOB-CATALOG-001')],
    location: loc(CATALOG_FILE),
  };
}

/** ジョブカタログの入力の状態(読込済み。0 件の空のカタログもここ)を作る。 */
export function loadedJobs(jobs: readonly JobDecl[]): CatalogInput<JobCatalogSpec> {
  return { state: 'loaded', value: jobCatalog(jobs), findings: [] };
}

/** JobSpecModel を作る(available は既定 true。`kindTerms` は `kind` の語彙の差し替え)。 */
export function jobModel(jobs: readonly JobDecl[], available = true, kindTerms?: readonly JobTermDecl[]): JobSpecModel {
  return { available, catalog: jobCatalog(jobs, kindTerms) };
}
