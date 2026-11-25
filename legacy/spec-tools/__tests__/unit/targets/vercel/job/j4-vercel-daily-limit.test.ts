/**
 * J4(Vercel Cron の頻度制約)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §scheduler。実測: Vercel Hobby は 1 日 1 回までしか
 * Cron を登録できない):
 *   - `scheduler: host` の cron 式は分・時が単一の固定値であること(= 1 日 1 回以下)
 *   - `scheduler: database` は対象外(高頻度はそちらへ逃がす設計)
 *   - まだ結線していない(`not_scheduled_reason`)行は cron 式が無いので対象外
 */

import { describe, expect, it } from 'vitest';
import { firesAtMostOncePerDay, verifyVercelDailyLimit } from '../../../../../lib/targets/vercel/job/j4-vercel-daily-limit.js';
import { jobModel, notScheduledJob, scheduledJob } from '../../../../helpers/job-builder.js';

describe('firesAtMostOncePerDay', () => {
  it('分・時が単一の固定値なら 1 日 1 回以下と判定する', () => {
    expect(firesAtMostOncePerDay('0 18 * * *')).toBe(true);
    expect(firesAtMostOncePerDay('30 3 * * 1')).toBe(true);
  });

  it('分に刻み(/)があれば 1 日複数回と判定する', () => {
    expect(firesAtMostOncePerDay('*/10 * * * *')).toBe(false);
  });

  it('時がワイルドカードなら 1 日複数回と判定する', () => {
    expect(firesAtMostOncePerDay('0 * * * *')).toBe(false);
  });

  it('時が範囲・列挙なら 1 日複数回と判定する', () => {
    expect(firesAtMostOncePerDay('0 8-18 * * *')).toBe(false);
    expect(firesAtMostOncePerDay('0 8,20 * * *')).toBe(false);
  });

  it('5 フィールドでない不正な形式は安全側(false)に倒す', () => {
    expect(firesAtMostOncePerDay('0 18 * *')).toBe(false);
  });
});

describe('J4: Vercel Cron の頻度制約', () => {
  it('scheduler: host で 1 日 1 回の cron 式なら違反なし', () => {
    const job = scheduledJob('sync_tutorial_docs', {
      cron: '0 18 * * *',
      endpoint: '/api/tutorial/sync',
      scheduler: 'host',
    });

    expect(verifyVercelDailyLimit(jobModel([job]))).toEqual([]);
  });

  it('scheduler: host で 1 日複数回の cron 式ならエラー', () => {
    const job = scheduledJob('run_due_jobs', { cron: '*/10 * * * *', scheduler: 'host' });

    const findings = verifyVercelDailyLimit(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs(scheduler: host)の schedule */10 * * * * は 1 日に複数回発火しうる cron 式です',
    );
  });

  it('scheduler: database は 1 日複数回でも対象外', () => {
    const job = scheduledJob('run_due_jobs', { cron: '*/10 * * * *', scheduler: 'database' });

    expect(verifyVercelDailyLimit(jobModel([job]))).toEqual([]);
  });

  it('まだ結線していない行(cron 式が無い)は対象外', () => {
    const job = notScheduledJob('detect_reachability', 'まだ結線していない');

    expect(verifyVercelDailyLimit(jobModel([job]))).toEqual([]);
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(verifyVercelDailyLimit({ available: true, catalog: null })).toEqual([]);
  });
});
