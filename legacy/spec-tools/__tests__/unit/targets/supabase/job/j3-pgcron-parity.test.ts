/**
 * J3(pg_cron ジョブの接地)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §scheduler):
 *   - `scheduler: database` の宣言が `supabase/migrations` の `cron.schedule` 登録と一致すること
 *   - cron 式が食い違えばエラー
 *   - migration にあるのにカタログに無ければエラー(逆方向)
 *
 * fixtures/jobs-repo/supabase/migrations に `run_due_jobs`(10 分おきの cron 式)を
 * 登録した固定ファイルを 1 本置いてある(J2 と同じ fixtures ディレクトリを共有)。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyPgCronParity } from '../../../../../lib/targets/supabase/job/j3-pgcron-parity.js';
import { pgCronSkipNote } from '../../../../../lib/verify/jobs-group.js';
import { jobModel, scheduledJob } from '../../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** fixtures/jobs-repo をリポジトリルートに見立てる(migrations に固定 fixture あり)。 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/jobs-repo',
);

/** fixture の登録とちょうど一致する既定のジョブ。 */
function goodJob() {
  return scheduledJob('run_due_jobs', { cron: '*/10 * * * *', scheduler: 'database' });
}

/** 既定の入力で J3 を回す。 */
function verify(jobs: ReturnType<typeof jobModel>) {
  return verifyPgCronParity({ roots: TEST_ROOTS, jobs, repoRoot: REPO_ROOT });
}

describe('J3: pg_cron ジョブの接地', () => {
  it('cron 式が migration の登録と一致していれば違反なし', () => {
    expect(verify(jobModel([goodJob()]))).toEqual([]);
  });

  it('cron 式が migration の登録と違えばエラー', () => {
    const job = scheduledJob('run_due_jobs', { cron: '*/5 * * * *', scheduler: 'database' });

    const findings = verify(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の schedule */5 * * * * が supabase/migrations/20260101000001_pg_cron_fixture.sql の cron.schedule 登録(*/10 * * * *)と違います',
    );
  });

  it('migration に登録が無ければエラー', () => {
    const job = scheduledJob('ghost_job', { cron: '*/10 * * * *', scheduler: 'database' });

    const findings = verify(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ ghost_job(scheduler: database)が supabase/migrations の cron.schedule に登録されていません',
    );
  });

  it('migration にあるのにカタログに scheduler: database の行が無ければエラー(逆方向)', () => {
    // カタログを空にすると、fixture の run_due_jobs 登録がどこにも宣言されていない扱いになる。
    const findings = verify(jobModel([]));

    expect(
      findings.some((finding) =>
        finding.message.includes('run_due_jobs(*/10 * * * *)がジョブカタログに scheduler: database として宣言されていません'),
      ),
    ).toBe(true);
  });

  it('scheduler: host のジョブは対象外(J2 が見る)', () => {
    const job = scheduledJob('run_due_jobs', { cron: '*/10 * * * *', scheduler: 'host' });

    const findings = verify(jobModel([job]));

    // 宣言側は scheduler: host なので pg_cron 側の突合対象から外れ、
    // fixture の登録は「宣言が無い」側として検出される。
    expect(findings.some((finding) => finding.message.includes('run_due_jobs'))).toBe(true);
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(verifyPgCronParity({ roots: TEST_ROOTS, jobs: { available: true, catalog: null }, repoRoot: REPO_ROOT })).toEqual([]);
  });

  it('migration の置き場そのものが無ければ突合せず、実行ログの一言がスキップを名指す', () => {
    const roots = { ...TEST_ROOTS, migrations: 'no-such-migrations' };
    const jobs = jobModel([scheduledJob('ghost_job', { cron: '*/10 * * * *', scheduler: 'database' })]);

    expect(verifyPgCronParity({ roots, jobs, repoRoot: REPO_ROOT })).toEqual([]);
    expect(pgCronSkipNote(jobs, REPO_ROOT, roots)).toBe(
      '(no-such-migrations が無いため、scheduler: database のジョブ 1 件の J3 の cron.schedule の突合はスキップ)',
    );
  });

  it('置き場が在れば実行ログの一言は出ない(突合する)', () => {
    expect(pgCronSkipNote(jobModel([goodJob()]), REPO_ROOT, TEST_ROOTS)).toBe('');
  });

  it('scheduler: database のジョブが無ければ、置き場が無くても一言は出ない', () => {
    const roots = { ...TEST_ROOTS, migrations: 'no-such-migrations' };
    const job = scheduledJob('run_due_jobs', { cron: '*/10 * * * *', scheduler: 'host' });

    expect(pgCronSkipNote(jobModel([job]), REPO_ROOT, roots)).toBe('');
  });
});
