/**
 * ジョブ仕様の検査の束ね役(`lib/job/run.ts`)が、**後段の登録した検査を口に当てて束ねる**ことのテスト。
 *
 *   - 後段ありの全部入り: 口(J2 / J3 / J4)が全部埋まり、違反の並びは「J1 → J2(接地 → ホストの登録の突合)→ 通知の接地 → 起動口の接地 → … → J3 → J4 → J5 → J6」
 *   - 後段なし: 口が埋まっていない検査(J2 のホストの部分・J3・J4)は**実行せず、埋まっていない口として名指す**。コアの J2(接地)・J1・J5・J6 は動く
 *   - 登録した後段の役割が口と違えば当てない(ID が同じでも)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runJobVerification } from '../../../lib/job/run.js';
import type { JobRunInput } from '../../../lib/job/run.js';
import { jobTargetsOf } from '../../../lib/target-api/contract.js';
import type { Target } from '../../../lib/target-api/contract.js';
import { JOB_CHECK_SLOTS, NO_JOB_TARGETS } from '../../../lib/job/target-checks.js';
import type { JobTargetRegistry } from '../../../lib/job/target-checks.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import { jobModel, notScheduledJob, scheduledJob } from '../../helpers/job-builder.js';
import { externalModel, integration } from '../../helpers/external-builder.js';
import { authCallback, authModel } from '../../helpers/auth-builder.js';
import { barePlatformTarget, TEST_LAYOUT, TEST_TARGETS } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { screenInput, screenSpec } from '../../helpers/screen-builder.js';

/** `app/vercel.json` と `supabase/` を持つ木をリポジトリルートに見立てる。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/jobs-repo');

const DOMAIN = specModel([
  aggregate('workshop', {
    entity: entitySpec('workshop', { fields: [field('entry_deadline', { kind: 'datetime' })] }),
    stateMachines: [
      machine('workshop', {
        states: ['accepting', 'closed'],
        initial: 'accepting',
        events: [event('close_deadline', { from: ['accepting'], to: 'closed', by: ['system'], otherwiseForbidden: '締切は募集中の催しにだけ意味がある' })],
      }),
    ],
  }),
]);

/**
 * コアの検査も後段の検査も違反を出すカタログ:
 *   - J2(接地)… `fires` がドメインに無い・口に対応する Route Handler が無い
 *   - J2(ホストの登録の突合)… 口 `/api/jobs/run` は 10 分おきで登録されているのに、毎日 3 時と宣言している・登録に無い口がある
 *   - J3 … migration に DB 内のスケジューラの登録があるのに、カタログに `scheduler: database` の行が無い
 *   - J4 … 5 分おき(1 日に複数回)の `scheduler: host`
 *   - J6 … 時刻起点の行が `next_run` でない語を選んでいる
 */
function brokenJobs() {
  return jobModel([
    scheduledJob('grounded_wrong', { endpoint: '/api/jobs/run', cron: '0 3 * * *', fires: 'workshop.teleport' }),
    scheduledJob('too_often', { endpoint: '/api/other/run', cron: '*/5 * * * *' }),
    notScheduledJob('wrong_meaning', 'まだ結線していない'),
  ].map((decl) => (decl.id === 'wrong_meaning' ? { ...decl, onFailure: 'retry_then_dead_letter' } : decl)));
}

/** 外部連携を採っていない製品の入力の状態(受信口が事実として無い)。 */
const UNSELECTED_EXTERNAL: JobRunInput['external'] = { state: 'unselected', findings: [] };

/** 後段の登録を指定して束ね役を回す。 */
function run(targets: Parameters<typeof jobTargetsOf>[0], overrides: Partial<JobRunInput> = {}) {
  return runJobVerification({ domain: DOMAIN, jobs: brokenJobs(), repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT, external: UNSELECTED_EXTERNAL, jobTargets: jobTargetsOf(targets), ...overrides });
}

describe('後段ありの全部入り(Supabase + Vercel)', () => {
  const result = run(TEST_TARGETS);

  it('口は全部埋まる(埋まっていない口は無い)', () => {
    expect(result.missingTargetChecks).toEqual([]);
    expect(result.notApplicableTargetChecks).toEqual([]);
  });

  it('違反の並びは束ね役の順: J2 の接地 → ホストの Cron の登録の突合 → 起動口の接地 → J3(DB 内スケジューラの登録)→ J4(頻度制約)→ J6', () => {
    const found = result.findings.map((finding) => [finding.verifier, finding.message] as const);
    expect(found.map(([verifier]) => verifier)).toEqual(['J2', 'J2', 'J2', 'J2', 'J2', 'J2', 'J3', 'J4', 'J6']);
    expect(found[0]?.[1]).toContain('fires workshop.teleport は state_spec に無い');
    expect(found[1]?.[1]).toContain('Route Handler がありません');
    // ここからがホストの後段の検査(登録ファイルとの双方向)。
    expect(found[2]?.[1]).toContain('app/vercel.json の登録(*/10 * * * *)と違います');
    expect(found[3]?.[1]).toContain('app/vercel.json に登録されていません');
    expect(found[4]?.[1]).toContain('ジョブカタログにありません');
    expect(found[5]?.[1]).toContain('起動口');
    expect(found[6]?.[1]).toContain('pg_cron 登録');
    expect(found[7]?.[1]).toContain('too_often');
  });

  it('後段の検査が全部突合した木では、突合しなかった分の一言(targetSkips)は空', () => {
    expect(result.targetSkips).toEqual([]);
  });

  it('仕様だけの段(migration の置き場も実装の木も無い)では、J3 を登録した後段の一言が targetSkips に載る', () => {
    const jobs = jobModel([scheduledJob('spec_only', { scheduler: 'database', cron: '5 5 * * *' })]);
    const specOnly = run(TEST_TARGETS, { jobs, roots: { ...TEST_ROOTS, migrations: 'none', app: null } });
    expect(specOnly.targetSkips).toHaveLength(1);
    expect(specOnly.targetSkips[0]).toContain('J3 の cron.schedule の突合はスキップ');
  });
});

describe('後段なし(プラットフォームの後段が検査を登録しない)', () => {
  const result = run([barePlatformTarget()]);

  it('埋まっていない口は J2・J3・J4 の 3 つ(口の表の並び)。後段の役割とともに名指せる', () => {
    expect(result.missingTargetChecks.map((slot) => [slot.id, slot.role])).toEqual([
      ['J2', 'host'],
      ['J3', 'platform'],
      ['J4', 'host'],
    ]);
  });

  it('後段の検査の違反(Cron の登録の突合・DB 内スケジューラの登録・頻度制約)は出ない。コアの J2(接地・起動口の接地)と J6 は実行される', () => {
    const found = result.findings.map((finding) => [finding.verifier, finding.message] as const);
    expect(found.map(([verifier]) => verifier)).toEqual(['J2', 'J2', 'J2', 'J6']);
    expect(found[0]?.[1]).toContain('fires workshop.teleport は state_spec に無い');
    expect(found[1]?.[1]).toContain('Route Handler がありません');
    expect(found.filter(([, message]) => message.includes('vercel.json') || message.includes('pg_cron 登録'))).toEqual([]);
  });

  it('ジョブカタログの件数などの報告は後段に依らない', () => {
    const full = run(TEST_TARGETS);
    expect([result.available, result.jobCount, result.scheduledCount, result.appGrounded]).toEqual([full.available, full.jobCount, full.scheduledCount, full.appGrounded]);
  });
});

describe('HTTP の入口の衝突(J2 の続き)の束ね', () => {
  const inbound = integration('billing_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' });
  const colliding = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);
  const external = (): JobRunInput['external'] => ({ state: 'loaded', value: externalModel([inbound]).catalog as NonNullable<ReturnType<typeof externalModel>['catalog']>, findings: [] });

  it('外部連携が読めていれば、ジョブの endpoint と受信口の URL の衝突を J2 として返す。配置は引数で渡る', () => {
    const result = run(TEST_TARGETS, { jobs: colliding, external: external() });

    expect(result.findings.filter((finding) => finding.message.includes('HTTP の入口が衝突しています'))).toHaveLength(1);
    expect(result.entryGaps).toEqual([]);
  });

  it('外部連携が阻害なら、衝突は見られないので違反は出さず、見ていないことを entryGaps で返す。未選択は事実として無いので何も言わない', () => {
    const blocked = run(TEST_TARGETS, { jobs: colliding, external: { state: 'blocked', reason: 'missing', findings: [] } });
    const none = run(TEST_TARGETS, { jobs: colliding });

    expect(blocked.findings.some((finding) => finding.message.includes('HTTP の入口が衝突しています'))).toBe(false);
    expect(blocked.entryGaps).toEqual([{ input: 'external', state: 'blocked', reason: 'missing' }]);
    expect(none.entryGaps).toEqual([]);
  });

  it('画面仕様(screens)が渡れば、画面の route も役割をまたぐ主張として入口の衝突に入る(page と route を同じセグメントに置けない)。渡さなければ見ない', () => {
    const jobs = jobModel([scheduledJob('cronjob', { endpoint: '/health' })]);
    const screens = screenInput({ screens: [screenSpec({ name: 'health', route: '/health' })] }).screens;

    const withScreens = run(TEST_TARGETS, { jobs, screens });
    const without = run(TEST_TARGETS, { jobs });

    expect(withScreens.findings.filter((finding) => finding.message.includes('画面 health の route /health'))).toHaveLength(1);
    expect(without.findings.filter((finding) => finding.message.includes('HTTP の入口が衝突しています'))).toEqual([]);
  });
});

describe('HTTP の入口の閉世界(J2 の続き)の束ね', () => {
  const closedFindings = (result: ReturnType<typeof run>): Finding[] => result.findings.filter((finding) => finding.message.includes('どの宣言にも当たりません'));

  it('実装の木の入口がどの宣言にも当たらなければ J2 として返す(fixtures の入口 /api/jobs/run を宣言するジョブが無い)。状態は実行済み・保留は無い', () => {
    const result = run(TEST_TARGETS, { jobs: jobModel([scheduledJob('elsewhere', { endpoint: '/api/other/run' })]) });

    expect(closedFindings(result).map((finding) => finding.counterexample?.['url'])).toEqual(['/api/jobs/run']);
    expect(result.entryClosed).toBe('ran');
    expect(result.entryClosedWithheld).toEqual([]);
  });

  it('違反の並びは、入口の衝突のあと・ホストの Cron の登録の突合の前(束ね役の順)。後段が無くても同じ(コアの検査)', () => {
    const jobs = jobModel([scheduledJob('elsewhere', { endpoint: '/api/other/run', cron: '*/10 * * * *' }), scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);
    const external = externalModel([integration('billing_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' })]).catalog;
    if (external === null) throw new Error('テストの前提が壊れています');
    const input = { jobs, external: { state: 'loaded' as const, value: external, findings: [] } };

    const order = (result: ReturnType<typeof run>): readonly string[] =>
      result.findings.map((finding) => (finding.message.includes('HTTP の入口が衝突') ? 'collision' : finding.message.includes('どの宣言にも当たりません') ? 'closed' : finding.message.includes('vercel.json') ? 'parity' : 'other'));

    // 同じ種類の連続は 1 つにまとめる(Cron の登録の突合は登録の食い違いの数だけ出る)。
    const kinds = (result: ReturnType<typeof run>): readonly string[] => order(result).filter((kind, index, all) => kind !== 'other' && kind !== all[index - 1]);

    expect(kinds(run(TEST_TARGETS, input))).toEqual(['collision', 'closed', 'parity']);
    expect(kinds(run([], input))).toEqual(['collision', 'closed']);
  });

  it('外部連携が阻害なら未宣言の判定を保留し(違反を出さず)、保留した種類を返す。認証仕様が構築できないときも同じ', () => {
    const jobs = jobModel([scheduledJob('elsewhere', { endpoint: '/api/other/run' })]);

    const external = run(TEST_TARGETS, { jobs, external: { state: 'blocked', reason: 'invalid', findings: [] } });
    const auth = run(TEST_TARGETS, { jobs, auth: { available: true, flow: null } });

    expect(closedFindings(external)).toEqual([]);
    expect(external.entryClosedWithheld).toEqual([{ input: 'external', state: 'blocked', reason: 'invalid' }]);
    expect(closedFindings(auth)).toEqual([]);
    expect(auth.entryClosedWithheld).toEqual([{ input: 'auth', state: 'blocked', reason: 'load-failed' }]);
  });

  it('ジョブのカタログを採らない製品でも(実装の木があれば)閉世界は見る。実装の木が無ければ no_tree', () => {
    const noJobs = { available: false, catalog: null } as const;

    const result = run(TEST_TARGETS, { jobs: noJobs });
    const noTree = run(TEST_TARGETS, { jobs: noJobs, roots: { ...TEST_ROOTS, app: null } });

    expect(result.available).toBe(false);
    expect(closedFindings(result)).toHaveLength(1);
    expect(result.entryClosed).toBe('ran');
    expect(noTree.entryClosed).toBe('no_tree');
    expect(noTree.findings).toEqual([]);
  });

  it('認証の callback は入口の衝突の主張にも入る(ジョブの endpoint と同じ URL なら衝突)', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/auth/callback' })]);

    const result = run(TEST_TARGETS, { jobs, auth: authModel({ callback: authCallback('/api/auth/callback') }) });

    expect(result.findings.filter((finding) => finding.message.includes('HTTP の入口が衝突しています'))).toHaveLength(1);
  });
});

describe('一部の口だけ埋まる構成', () => {
  it('ホストの後段だけを外す(プラットフォームの後段は J3 を登録する): J2 と J4 が埋まらず、J3 は埋まる', () => {
    const supabaseOnly = TEST_TARGETS.filter((target) => target.role === 'platform');
    expect(run(supabaseOnly).missingTargetChecks.map((slot) => slot.id)).toEqual(['J2', 'J4']);
  });

  it('J3 を登録しないプラットフォームの後段 + ホストの後段: J3 だけが埋まらない', () => {
    const withoutPlatformChecks = [barePlatformTarget(), ...TEST_TARGETS.filter((target) => target.role === 'host')];
    expect(run(withoutPlatformChecks).missingTargetChecks.map((slot) => slot.id)).toEqual(['J3']);
  });

  it('同じ ID でも役割の違う後段が登録した検査は当てない(J4 はホストの口)', () => {
    const j4 = TEST_TARGETS.flatMap((target) => target.verifiers).find((verifier) => verifier.id === 'J4');
    if (j4 === undefined) throw new Error('J4 を登録した後段が無い');
    const wrongRole: JobTargetRegistry = { checks: [{ role: 'platform' as const, check: j4 }], targets: [] };
    expect(run([], { jobTargets: wrongRole }).missingTargetChecks.map((slot) => slot.id)).toEqual(['J2', 'J3', 'J4']);
  });
});

describe('埋まらない理由と対象外の宣言(束ね役の結果)', () => {
  it('後段を選んでいるのに口を登録していなければ、口に選んだ後段の名前が付く。選んでいない役割の口には付かない', () => {
    const result = run([barePlatformTarget()]);
    expect(result.missingTargetChecks.map((slot) => [slot.id, slot.selectedTarget])).toEqual([
      ['J2', undefined],
      ['J3', 'bare-platform'],
      ['J4', undefined],
    ]);
  });

  it('後段が口を対象外と宣言すれば、未実施には出ず、対象外の口として返る(その口の検査は実行しない)', () => {
    const quietHost: Target = { id: 'quiet-host', role: 'host', verifiers: [], generators: [], notApplicable: { J2: '登録ファイルを持たない', J4: '頻度の制約が無い' } };
    const result = run([...TEST_TARGETS.filter((target) => target.role === 'platform'), quietHost]);
    expect(result.missingTargetChecks).toEqual([]);
    expect(result.notApplicableTargetChecks.map((slot) => [slot.id, slot.target, slot.reason])).toEqual([
      ['J2', 'quiet-host', '登録ファイルを持たない'],
      ['J4', 'quiet-host', '頻度の制約が無い'],
    ]);
    expect(result.findings.map((finding) => finding.verifier)).toEqual(['J2', 'J2', 'J2', 'J3', 'J6']);
  });
});

describe('口の表(JOB_CHECK_SLOTS)と束ね役の呼び出し位置の対応', () => {
  /** 口の表の全口に、呼ばれたことを記録する検査を、口の役割の後段が登録する形で用意する。 */
  function recordingTargets(called: string[]): readonly Target[] {
    const platform = barePlatformTarget();
    const byRole = new Map<string, Target['verifiers'][number][]>();
    for (const slot of JOB_CHECK_SLOTS) {
      const verifier = {
        group: 'job' as const,
        id: slot.id,
        verify: (): Finding[] => {
          called.push(slot.id);
          return [];
        },
      };
      byRole.set(slot.role, [...(byRole.get(slot.role) ?? []), verifier]);
    }
    return [
      { ...platform, verifiers: byRole.get('platform') ?? [] },
      { id: 'recording-host', role: 'host', verifiers: byRole.get('host') ?? [], generators: [] },
    ];
  }

  it('口の表の全口が runJobVerification で呼ばれる(表に口を足して呼び出しを足し忘れる / 呼び出しだけ足して表を足し忘れると赤)', () => {
    const called: string[] = [];
    const result = run(recordingTargets(called));
    expect(result.missingTargetChecks).toEqual([]);
    expect(called.sort()).toEqual(JOB_CHECK_SLOTS.map((slot) => slot.id).sort());
    expect(called.length).toBe(new Set(called).size);
  });

  it('口の表にある口は、束ね役が口ごとに 1 回だけ呼ぶ(違反の並びは表の並びと同じ向き)', () => {
    const called: string[] = [];
    run(recordingTargets(called));
    expect(called).toEqual(JOB_CHECK_SLOTS.map((slot) => slot.id));
  });
});

describe('ジョブカタログが無いとき', () => {
  it('検査は何も実行しない。口の報告も出さない(カタログが無いことが先に言われる)', () => {
    const result = runJobVerification({
      domain: DOMAIN,
      jobs: { available: false, catalog: null },
      repoRoot: REPO_ROOT,
      roots: TEST_ROOTS,
      layout: TEST_LAYOUT,
      external: UNSELECTED_EXTERNAL,
      jobTargets: NO_JOB_TARGETS,
    });
    expect(result.available).toBe(false);
    expect(result.missingTargetChecks).toEqual([]);
    expect(result.notApplicableTargetChecks).toEqual([]);
    // 実行しないのはジョブの検査。HTTP の入口の閉世界(J2 の続き)はジョブに依らず実装の木を走査する(ジョブの宣言が無いので、fixtures の入口は未宣言)。
    expect(result.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('HTTP の入口 /api/jobs/run')]);
  });
});
