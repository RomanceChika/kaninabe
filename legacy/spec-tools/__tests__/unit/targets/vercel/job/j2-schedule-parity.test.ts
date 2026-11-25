/**
 * J2 のホストの後段の部分(Cron の登録の突合)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証): **schedule と Cron の登録(app/vercel.json)の双方向一致**(間隔違いも捕まえる)。
 * 対象は `scheduler: host` の行だけで、実装・Route Handler・fires・due_from の接地はコアの J2 が見る
 * (`job/verifiers/j2-schedule-grounding.test.ts`)。
 *
 * この検査器は I/O を伴う(登録ファイルを読むのが仕事)ため、fixtures/jobs-repo をリポジトリルートに見立てて回す。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cronConfigFile, readCronEntries, verifyCronRegistration } from '../../../../../lib/targets/vercel/job/j2-schedule-parity.js';
import { jobModel, notScheduledJob, scheduledJob } from '../../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** `app/` を持たない木(仕様だけのリポジトリ)をリポジトリルートに見立てる。 */
const SPEC_ONLY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/samples/library');

/** fixtures/jobs-repo をリポジトリルートに見立てる(`app/vercel.json` に `/api/jobs/run` が 10 分おきで登録されている)。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/jobs-repo');

/** fixtures の Cron 登録とちょうど一致する既定のジョブ。 */
function goodJob() {
  return scheduledJob('run_due_jobs', { cron: '*/10 * * * *', endpoint: '/api/jobs/run' });
}

/** 検査を回す(ドメインモデルは使わない検査なので空のモデルを渡す)。 */
function verify(jobs: ReturnType<typeof jobModel>, repoRoot = REPO_ROOT) {
  return verifyCronRegistration({ roots: TEST_ROOTS, jobs, repoRoot });
}

describe('J2(ホストの後段): Cron の登録の双方向一致', () => {
  it('登録とちょうど一致していれば違反なし', () => {
    expect(verify(jobModel([goodJob()]))).toEqual([]);
  });

  it('間隔だけ違う登録は両方向から落ちる(口が合っていても通さない)', () => {
    // 「宣言した組が登録に無い」と「登録された組が宣言に無い」の**両方**が出るのが双方向であることの現れである(片方向なら 1 件で済んでしまう)。
    const job = scheduledJob('detect_reachability', { endpoint: '/api/jobs/run', cron: '0 3 * * *' });

    const messages = verify(jobModel([job])).map((finding) => finding.message);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('app/vercel.json の登録(*/10 * * * *)と違います');
    expect(messages[1]).toContain('ジョブカタログにありません');
  });

  it('宣言した口が登録に無ければエラー', () => {
    const job = scheduledJob('run_other', { endpoint: '/api/other/run', cron: '0 3 * * *' });

    const messages = verify(jobModel([goodJob(), job])).map((finding) => finding.message);

    expect(messages).toEqual(['ジョブ run_other の口 /api/other/run が app/vercel.json に登録されていません']);
  });

  it('Cron にあるのにカタログに無ければエラー(定期実行が仕様に現れない)', () => {
    const job = notScheduledJob('detect_reachability', 'まだ結線していない');

    const findings = verify(jobModel([job]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ジョブカタログにありません');
    expect(findings[0]?.message).toContain('/api/jobs/run');
  });

  it('まだ結線していないジョブは Cron の登録を要求されない', () => {
    const notWired = notScheduledJob('detect_reachability', 'Bot の運用設定と同時に結線する');

    expect(verify(jobModel([goodJob(), notWired]))).toEqual([]);
  });

  it('対象は scheduler: host の行だけ(scheduler: database の行は Cron に登録しないので、登録が無くても通る)', () => {
    const pg = scheduledJob('pg_job', { scheduler: 'database', endpoint: '/api/pg/run', cron: '5 5 * * *' });

    expect(verify(jobModel([goodJob(), pg]))).toEqual([]);
  });

  it('app/ が無いリポジトリでは登録の突合を飛ばす(仕様だけの木も正当)', () => {
    const job = scheduledJob('run_due_jobs', { endpoint: '/api/ghost/run', cron: '0 3 * * *' });

    expect(verify(jobModel([job]), SPEC_ONLY_ROOT)).toEqual([]);
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(verify({ available: true, catalog: null })).toEqual([]);
  });
});

describe('Cron の登録ファイルの読み方', () => {
  it('登録の置き場は実装の木の直下の vercel.json。実装の木を持たない製品では無い', () => {
    expect(cronConfigFile(TEST_ROOTS)).toBe('app/vercel.json');
    expect(cronConfigFile({ ...TEST_ROOTS, app: null })).toBeNull();
  });

  it('登録を (口, cron 式) の組で読む。ファイルが無い木では空', () => {
    expect(readCronEntries(REPO_ROOT, TEST_ROOTS)).toEqual([{ path: '/api/jobs/run', schedule: '*/10 * * * *' }]);
    expect(readCronEntries(SPEC_ONLY_ROOT, TEST_ROOTS)).toEqual([]);
  });
});
