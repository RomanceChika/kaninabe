/**
 * A13(schedule / manual ジョブの直接のテストケース)と、入力の状態の 3 反例のテスト。
 *
 * 同じジョブカタログ(直接のテストケースを持たない schedule ジョブ 1 本)を、**入力の状態だけを変えて**渡す。
 *   (i)   未選択(製品が jobs を採っていない)→ 未実施。違反は出ない(検査しなかった)
 *   (ii)  阻害(採ったのに読めない・壊れている)→ 阻害。違反は出ない(検査しなかった)。読み込みの診断は別に保たれる
 *   (iii) 読込済み → 実行。空のカタログも実行(0 件)・違反があれば残る(実行は合格を意味しない)
 * 実ローダー・実パイプラインとの接続(出力に出る行)は verify/input-state-counterexamples.test.ts が見る。
 */

import { describe, expect, it } from 'vitest';
import { catalogInput } from '../../../../lib/kernel/input-state.js';
import type { Finding } from '../../../../lib/kernel/finding.js';
import type { JobCatalogSpec } from '../../../../lib/model/job/types.js';
import { scheduleManualJobTagsVerifier } from '../../../../lib/trace/verifiers/a13-schedule-manual-job-tags.js';
import { isInputStateVerifier } from '../../../../lib/trace/verifier.js';
import { jobCatalog, notScheduledJob, outboxJob } from '../../../helpers/job-builder.js';
import { traceInput } from '../../../helpers/trace-builder.js';

/** 直接のテストケース(spec_ids に自身の ID)を持たない schedule ジョブ 1 本を含むカタログ。 */
const UNTAGGED = jobCatalog([notScheduledJob('scan_due', '結線前')]);

const loaderError: Finding = {
  verifier: 'J0',
  severity: 'error',
  message: 'jobs.md を読めません',
  location: { file: 'docs/specs/backend/jobs.md' },
  suggestion: '直す',
};

describe('A13 は入力の状態を報告する検査である', () => {
  it('検査器の登録は入力の状態を持つ形(jobs を要る)', () => {
    expect(isInputStateVerifier(scheduleManualJobTagsVerifier)).toBe(true);
    expect(scheduleManualJobTagsVerifier.kind).toBe('jobs');
  });
});

describe('(i) 未選択 — 製品が jobs を採っていない', () => {
  const input = traceInput({ jobs: catalogInput<JobCatalogSpec>('unselected') });

  it('未実施で、違反は出ない(従来の verify の呼び口でも空)', () => {
    expect(scheduleManualJobTagsVerifier.run(input)).toMatchObject({ status: 'skipped', reason: 'unselected' });
    expect(scheduleManualJobTagsVerifier.verify(input)).toEqual([]);
  });

  it('省略した入力(traceInput の既定)も未選択である', () => {
    expect(scheduleManualJobTagsVerifier.run(traceInput()).status).toBe('skipped');
  });
});

describe('(ii) 阻害 — 採ったのに検査へ渡せない', () => {
  it.each([
    ['読み込みが無い', catalogInput<JobCatalogSpec>('selected'), 'not-loaded'],
    ['置き場が無い', catalogInput<JobCatalogSpec>('selected', { model: { available: false, catalog: null }, findings: [], dropped: 0 }), 'missing'],
    [
      '壊れていて読めない',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: null }, findings: [loaderError], dropped: 0 }),
      'load-failed',
    ],
    [
      '部分のモデルに error が残る',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: UNTAGGED }, findings: [loaderError], dropped: 1 }),
      'invalid',
    ],
  ] as const)('%sなら阻害(%s)で、違反は出ない', (_label, jobs, reason) => {
    const run = scheduleManualJobTagsVerifier.run(traceInput({ jobs }));

    expect(run).toMatchObject({ status: 'blocked', reason });
    expect(run.verifierFindings).toEqual([]);
  });

  it('読み込みの診断は結果に別に保たれる(全体へ足し直されない)', () => {
    const jobs = catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: null }, findings: [loaderError], dropped: 0 });

    const run = scheduleManualJobTagsVerifier.run(traceInput({ jobs }));

    expect(run.loaderFindings).toEqual([loaderError]);
    expect(scheduleManualJobTagsVerifier.verify(traceInput({ jobs }))).toEqual([]);
  });
});

describe('(iii) 読込済み — 実行(空のカタログも)', () => {
  it('空のカタログは実行され、0 件である', () => {
    const jobs = catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: jobCatalog([]) }, findings: [], dropped: 0 });

    expect(scheduleManualJobTagsVerifier.run(traceInput({ jobs }))).toEqual({
      status: 'executed',
      loaderFindings: [],
      verifierFindings: [],
    });
  });

  it('直接のテストケースを持たない schedule / manual ジョブは違反として残る(実行は合格ではない)', () => {
    const jobs = catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: UNTAGGED }, findings: [], dropped: 0 });

    const run = scheduleManualJobTagsVerifier.run(traceInput({ jobs }));

    expect(run.status).toBe('executed');
    expect(run.verifierFindings.map((finding) => [finding.verifier, finding.severity])).toEqual([['A13', 'error']]);
    expect(run.verifierFindings[0]?.counterexample).toEqual({ job: 'scan_due', source: 'schedule' });
  });

  it('outbox のジョブは対象外で、warning だけの読み込みの診断は実行を止めない', () => {
    const warning: Finding = { ...loaderError, severity: 'warning' };
    const jobs = catalogInput<JobCatalogSpec>('selected', {
      model: { available: true, catalog: jobCatalog([outboxJob('notify_x')]) },
      findings: [warning],
      dropped: 0,
    });

    const run = scheduleManualJobTagsVerifier.run(traceInput({ jobs }));

    expect(run).toMatchObject({ status: 'executed', verifierFindings: [], loaderFindings: [warning] });
  });
});
