/**
 * J2(時刻で起きるジョブの接地。**コアの部分**)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   - 実装モジュール・Route Handler の実在
 *   - fires がドメインイベントとして実在すること
 *   - due_from が entity_spec のフィールドとして実在すること
 *
 * schedule と Cron の登録の双方向一致は、ホストの後段が登録する検査(`targets/vercel/job/j2-schedule-parity.test.ts`)が見る。
 * ここは**どのホストでも成り立つ接地だけ**で、Cron の登録を見ないこと(登録と間隔が食い違っていても何も言わない)も固定する。
 *
 * この検証器だけは I/O を伴う(実在を見るのが仕事)ため、fixtures/jobs-repo を
 * リポジトリルートに見立てて回す(trace / screen の app 側テストと同じ流儀)。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyScheduleGrounding } from '../../../../lib/job/verifiers/j2-schedule-grounding.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';

/** `app/` を持たない木(仕様だけのリポジトリ)をリポジトリルートに見立てる。 */
const SPEC_ONLY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/samples/library',
);

/** fixtures/jobs-repo をリポジトリルートに見立てる。 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/jobs-repo',
);

/** workshop.close_deadline と workshop.entry_deadline を持つ最小ドメインモデル。 */
const DOMAIN = specModel([
  aggregate('workshop', {
    entity: entitySpec('workshop', { fields: [field('entry_deadline', { kind: 'datetime' })] }),
    stateMachines: [
      machine('workshop', {
        states: ['accepting', 'closed'],
        initial: 'accepting',
        events: [
          event('close_deadline', {
            from: ['accepting'],
            to: 'closed',
            by: ['system'],
            otherwiseForbidden: '締切は募集中の催しにだけ意味がある',
          }),
        ],
      }),
    ],
  }),
]);

/** fixtures の Cron 登録とちょうど一致する既定のジョブ。 */
function goodJob() {
  return scheduledJob('run_due_jobs', {
    cron: '*/10 * * * *',
    endpoint: '/api/jobs/run',
    implementation: 'app/src/operation/jobs/run-due-jobs.ts',
  });
}

/** 既定の入力で J2 を回す。 */
function verify(jobs: ReturnType<typeof jobModel>) {
  return verifyScheduleGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, jobs, repoRoot: REPO_ROOT });
}

describe('J2: 時刻で起きるジョブの接地(コアの部分)', () => {
  it('実装も口もそろっていれば違反なし', () => {
    expect(verify(jobModel([goodJob()]))).toEqual([]);
  });

  it('implementation が実在しなければエラー', () => {
    const job = scheduledJob('run_due_jobs', {
      implementation: 'app/src/operation/jobs/ghost.ts',
    });

    const findings = verify(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の implementation app/src/operation/jobs/ghost.ts が実在しません',
    );
  });

  it('endpoint に対応する Route Handler が無ければエラー', () => {
    const job = scheduledJob('run_due_jobs', { endpoint: '/api/ghost/run' });

    const findings = verify(jobModel([job]));

    expect(findings.some((finding) => finding.message.includes('Route Handler がありません'))).toBe(true);
  });

  it('fires が state_spec に無いイベントならエラー', () => {
    const job = scheduledJob('run_due_jobs', { fires: 'workshop.teleport' });

    const findings = verify(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の fires workshop.teleport は state_spec に無いドメインイベントです',
    );
  });

  it('fires が実在するイベントなら違反なし', () => {
    const job = scheduledJob('run_due_jobs', { fires: 'workshop.close_deadline' });

    expect(verify(jobModel([job]))).toEqual([]);
  });

  it('due_from が entity_spec に無いフィールドならエラー', () => {
    const job = scheduledJob('run_due_jobs', { dueFrom: 'workshop.ghost_at' });

    const findings = verify(jobModel([job]));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の due_from workshop.ghost_at は entity_spec に無いフィールドです',
    );
  });

  it('due_from が実在するフィールドなら違反なし', () => {
    const job = scheduledJob('run_due_jobs', { dueFrom: 'workshop.entry_deadline' });

    expect(verify(jobModel([job]))).toEqual([]);
  });

  it('Cron の登録は見ない(間隔が食い違っていても、登録に無い口があっても、接地としては違反なし。突合はホストの後段の検査)', () => {
    const job = scheduledJob('detect_reachability', { endpoint: '/api/jobs/run', cron: '0 3 * * *' });

    expect(verify(jobModel([job]))).toEqual([]);
  });

  it('配置を差し替えると、期待する Route Handler の位置がその配置の値になる(Next.js の位置は出ない)', () => {
    const findings = verifyScheduleGrounding({
      roots: TEST_ROOTS,
      layout: FOREIGN_LAYOUT,
      domain: DOMAIN,
      jobs: jobModel([goodJob()]),
      repoRoot: REPO_ROOT,
    });

    const route = findings.find((finding) => finding.message.includes('Route Handler がありません'));
    expect(route?.counterexample).toEqual({ job: 'run_due_jobs', expected_route: 'app/server_code/endpoints/api/jobs/run.handler.ts' });
    expect(route?.suggestion).not.toContain('route.ts');
  });

  it('配置が http-entry を宣言していなければ、Route Handler の位置を決められないと言う(黙って通さない)', () => {
    const findings = verifyScheduleGrounding({ roots: TEST_ROOTS, layout: {}, domain: DOMAIN, jobs: jobModel([goodJob()]), repoRoot: REPO_ROOT });

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の endpoint /api/jobs/run に対応する Route Handler の位置を決められません(置き場の配置に http-entry がありません)',
    );
  });

  it('app/ が無いリポジトリでは実装・Route Handler の突合を飛ばす(仕様だけの木も正当)', () => {
    const job = scheduledJob('run_due_jobs', {
      implementation: 'app/src/operation/jobs/ghost.ts',
      endpoint: '/api/ghost/run',
    });

    const findings = verifyScheduleGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, jobs: jobModel([job]), repoRoot: SPEC_ONLY_ROOT });

    expect(findings).toEqual([]);
  });

  it('app/ が無くても fires / due_from は見る(ドメイン仕様だけで判定できる)', () => {
    const job = scheduledJob('run_due_jobs', { fires: 'workshop.teleport' });

    const findings = verifyScheduleGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, jobs: jobModel([job]), repoRoot: SPEC_ONLY_ROOT });

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ run_due_jobs の fires workshop.teleport は state_spec に無いドメインイベントです',
    );
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(
      verifyScheduleGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, jobs: { available: true, catalog: null }, repoRoot: REPO_ROOT }),
    ).toEqual([]);
  });
});
