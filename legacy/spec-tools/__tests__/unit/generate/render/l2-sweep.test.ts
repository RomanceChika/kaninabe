/**
 * L2 網羅スイープ(render/l2-sweep.ts とその行組み立て 4 本)のテスト。
 *
 * BACKLOG「E2E拡張束 — 4層テスト戦略」の L2 に対する規約網羅テスト。対象の要求:
 * ① 遷移 × 分類(成立/不成立の内訳)の行が state_spec だけから機械的に出る
 * ② test_cases の covers / spec_ids から「確認しているテスト」が埋まる
 * ③ 証拠が 0 件の行が rowsWithoutEvidence に集まる(章末の一覧の元)
 * ④ 各グループが「まだ対象が無い」を空配列で表す(available: false / 未読み込み)
 */

import { describe, expect, it } from 'vitest';

import { buildL2SweepRows, rowsWithoutEvidence } from '../../../../lib/generate/render/l2-sweep.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { NotificationSpecModel } from '../../../../lib/model/notification/types.js';
import type { JobSpecModel } from '../../../../lib/model/job/types.js';
import type { ActionTestCase } from '../../../../lib/testcase/types.js';
import {
  accessSpec,
  aggregate,
  effect,
  entitySpec,
  event,
  field,
  machine,
  role,
  roleSpec,
  specModel,
  write,
} from '../../../helpers/model-builder.js';
import { actionSpec, testCase } from '../../../helpers/trace-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/**
 * entry.submit(from: draft, guard あり, by: performer)を持つ最小ドメイン。
 * 状態は draft/submitted の 2 つ(from に含まれない submitted があるので invalid_from が要る)、
 * ロールは performer(許可)/ member(拒否される側)/ system。
 */
function domain() {
  const entry = aggregate('entry', {
    entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }),
    stateMachines: [
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [
          event('submit', {
            from: ['draft'],
            to: 'submitted',
            by: ['performer'],
            guard: 'workshop.state == accepting',
          }),
        ],
      }),
    ],
    access: accessSpec('entry', { writes: [write('performer', ['title'])] }),
  });
  return specModel([entry], roleSpec([role('performer'), role('member'), role('system')]));
}

/** 独自の spec_ids を持つテストケースを 1 件作る(通知・ジョブの証拠テスト用)。 */
function tc(id: string, specIds: readonly string[]): ActionTestCase {
  return testCase({ id, implementation: `app/x.test.ts::${id}`, specIds, covers: ['success'] });
}

describe('buildL2SweepRows: ① 状態遷移 × {成立, 不成立}', () => {
  it('guard・invalid_from・forbidden の条件が揃うと 4 行(成立 + 不成立 3 種)出る', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: {
        actions: [actionSpec({ handles: 'entry.submit', testCases: [testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] })] })],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '状態遷移');

    expect(rows.map((row) => row.aspect)).toEqual([
      '成立',
      '不成立(guard 不成立)',
      '不成立(状態違い)',
      '不成立(権限無し)',
    ]);
    expect(rows.every((row) => row.subject === 'entry.submit')).toBe(true);
  });

  it('covers に一致する test_cases だけが証拠として埋まる(それ以外は 0 件)', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: {
        actions: [
          actionSpec({
            handles: 'entry.submit',
            testCases: [
              testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] }),
              testCase({
                id: 'TC-ENTRY-SUBMIT-002',
                implementation: 'app/e.test.ts::guard不成立',
                covers: ['guard_unsatisfied'],
              }),
            ],
          }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '状態遷移');

    const success = rows.find((row) => row.aspect === '成立');
    const guard = rows.find((row) => row.aspect === '不成立(guard 不成立)');
    const invalidFrom = rows.find((row) => row.aspect === '不成立(状態違い)');
    const forbidden = rows.find((row) => row.aspect === '不成立(権限無し)');

    expect(success?.evidence.map((e) => e.id)).toEqual(['TC-ENTRY-SUBMIT-001']);
    expect(guard?.evidence.map((e) => e.id)).toEqual(['TC-ENTRY-SUBMIT-002']);
    expect(invalidFrom?.evidence).toEqual([]);
    expect(forbidden?.evidence).toEqual([]);
  });

  it('action_spec が無い遷移は全観点が 0 件になる(action_spec が母集合を絞らない)', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
    };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '状態遷移');

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.evidence.length === 0)).toBe(true);
  });
});

describe('buildL2SweepRows: ② 画面 × 操作', () => {
  it('screen_spec の test_cases の spec_ids が一致した行だけ証拠が埋まる', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      screens: {
        available: true,
        screens: [
          screenSpec({
            name: 'entry_form',
            actions: ['entry.submit'],
            testCases: [testCase({ id: 'TC-SCREEN-ENTRY_FORM-001', implementation: 'app/s.test.ts::発火', specIds: ['entry.submit'] })],
          }),
          screenSpec({ name: 'entry_other', actions: ['entry.release'] }),
        ],
        chromes: [],
        unexposed: [],
        unreachableStates: [],
        unseenStates: [],
      },
    };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '画面 × 操作');

    const covered = rows.find((row) => row.subject === 'screen-entry-form × entry.submit');
    const uncovered = rows.find((row) => row.subject === 'screen-entry-other × entry.release');

    expect(covered?.evidence.map((e) => e.id)).toEqual(['TC-SCREEN-ENTRY_FORM-001']);
    expect(uncovered?.evidence).toEqual([]);
  });

  it('screens が available: false なら空(まだ画面を仕様化していない)', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      screens: { available: false, screens: [], chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
    };

    expect(buildL2SweepRows(domain(), ctx).filter((row) => row.section === '画面 × 操作')).toEqual([]);
  });
});

describe('buildL2SweepRows: ③ 読み取り経路 × 実行ロール', () => {
  it('for に並ぶ全ロールへ、そのクエリの test_cases が同じものとして充てられる', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      queries: {
        available: true,
        queries: [
          querySpec({
            name: 'entry_list',
            source: 'entry',
            for: ['member', 'performer'],
            scopeUsed: 'all',
            testCases: [testCase({ id: 'TC-QUERY-ENTRY_LIST-001', implementation: 'app/q.test.ts::一覧', specIds: ['query-entry-list'] })],
          }),
        ],
      },
    };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '読み取り経路');

    expect(rows.map((row) => row.subject)).toEqual(['query-entry-list × member', 'query-entry-list × performer']);
    expect(rows.every((row) => row.evidence.map((e) => e.id).join(',') === 'TC-QUERY-ENTRY_LIST-001')).toBe(true);
  });
});

describe('buildL2SweepRows: ④ 通知 / ⑤ ジョブ', () => {
  const notifications: NotificationSpecModel = {
    available: true,
    catalog: {
      id: 'notification-catalog',
      vocabulary: { medium: [{ id: 'discord' }], audience: [{ id: 'staff_channel' }], mention: [{ id: 'none' }] },
      notifications: [
        {
          id: 'notify_entry_submitted',
          medium: 'discord',
          audience: 'staff_channel',
          mention: 'none',
          trigger: 'auto',
          summary: '申込みを知らせる',
          recipient: { kind: 'role', role: 'staff' },
          location: { file: 'docs/specs/backend/notifications.md' },
        },
      ],
      // カタログ全体の整合テスト(spec_ids はカタログ ID のみ)は、通知固有の行の証拠にならない。
      testCases: [tc('TC-NOTIFICATION-CATALOG-001', ['notification-catalog'])],
      location: { file: 'docs/specs/backend/notifications.md' },
    },
  };
  const jobs: JobSpecModel = {
    available: true,
    catalog: {
      id: 'job-catalog',
      vocabulary: { kind: [{ id: 'scan' }], on_failure: [{ id: 'skip_and_next_run' }] },
      jobs: [
        {
          id: 'job_close_deadline',
          source: 'schedule',
          kind: 'scan',
          onFailure: 'skip_and_next_run',
          summary: '締切を締める',
          schedule: {
            cron: '*/10 * * * *',
            endpoint: '/api/jobs/run',
            implementation: 'app/src/operation/jobs/run.ts',
            scheduler: 'database',
          },
          location: { file: 'docs/specs/backend/jobs.md' },
        },
      ],
      // job_close_deadline(source: schedule)を名指しする直接のテストケースを 1 本用意する。
      testCases: [tc('TC-JOB-CATALOG-001', ['job-catalog']), tc('TC-JOB-CLOSE_DEADLINE-001', ['job_close_deadline'])],
      location: { file: 'docs/specs/backend/jobs.md' },
    },
  };

  /**
   * entry.submit の effects に `notify_entry_submitted` / `job_send_notification`(outbox)を
   * 積む版のドメイン(帰属規則(a)(b)の「導出」を確かめるための唯一の違い)。
   */
  function domainWithEffects() {
    const entry = aggregate('entry', {
      entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }),
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          events: [
            event('submit', {
              from: ['draft'],
              to: 'submitted',
              by: ['performer'],
              guard: 'workshop.state == accepting',
            }),
          ],
          effects: [effect('submit', ['notify_entry_submitted', 'job_send_notification'])],
        }),
      ],
      access: accessSpec('entry', { writes: [write('performer', ['title'])] }),
    });
    return specModel([entry], roleSpec([role('performer'), role('member'), role('system')]));
  }

  /** 遷移由来の証拠の出どころ(entry.submit の成功ケース 1 本)。 */
  const submitSuccess = actionSpec({
    handles: 'entry.submit',
    testCases: [testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] })],
  });

  it('通知の証拠は、カタログ全体の整合テスト(直接)と遷移由来の成功ケース(導出)の合算になる', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [submitSuccess], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      notifications,
    };
    const rows = buildL2SweepRows(domainWithEffects(), ctx).filter((row) => row.section === '通知');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('notify_entry_submitted');
    expect(rows[0]?.evidence).toEqual([
      { id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', origin: 'derived' },
      { id: 'TC-NOTIFICATION-CATALOG-001', implementation: 'app/x.test.ts::TC-NOTIFICATION-CATALOG-001', origin: 'direct' },
    ]);
  });

  it('通知は、effects からの導出が無くてもカタログ全体の整合テスト(直接)だけで証拠が埋まる', () => {
    const ctx: GenerateContext = { ...GEN_CTX, actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }, notifications };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === '通知');

    expect(rows[0]?.evidence.map((e) => e.id)).toEqual(['TC-NOTIFICATION-CATALOG-001']);
    expect(rows[0]?.evidence.every((e) => e.origin === 'direct')).toBe(true);
  });

  it('source: schedule のジョブは、自身の ID を spec_ids に挙げる直接のテストケースだけが証拠になる(カタログ全体の整合テストは数えない)', () => {
    const ctx: GenerateContext = { ...GEN_CTX, actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }, jobs };
    const rows = buildL2SweepRows(domain(), ctx).filter((row) => row.section === 'ジョブ');

    expect(rows[0]?.evidence).toEqual([
      { id: 'TC-JOB-CLOSE_DEADLINE-001', implementation: 'app/x.test.ts::TC-JOB-CLOSE_DEADLINE-001', origin: 'direct' },
    ]);
  });

  it('source: outbox の非通知ジョブは、遷移由来の成功ケース(導出)+ job-catalog の整合テスト(直接)が証拠になる', () => {
    const outboxJobs: JobSpecModel = {
      available: true,
      catalog: {
        id: 'job-catalog',
        vocabulary: { kind: [{ id: 'transaction_effect', inTransaction: true }], on_failure: [{ id: 'wiring_error' }] },
        jobs: [
          {
            id: 'job_send_notification',
            source: 'outbox',
            kind: 'transaction_effect',
            inTransaction: true,
            onFailure: 'wiring_error',
            summary: '書き込みと同時に実現済み',
            location: { file: 'docs/specs/backend/jobs.md' },
          },
        ],
        testCases: [tc('TC-JOB-CATALOG-001', ['job-catalog'])],
        location: { file: 'docs/specs/backend/jobs.md' },
      },
    };
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [submitSuccess], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      jobs: outboxJobs,
    };
    const rows = buildL2SweepRows(domainWithEffects(), ctx).filter((row) => row.section === 'ジョブ');

    expect(rows[0]?.evidence).toEqual([
      { id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', origin: 'derived' },
      { id: 'TC-JOB-CATALOG-001', implementation: 'app/x.test.ts::TC-JOB-CATALOG-001', origin: 'direct' },
    ]);
  });

  it('source: outbox で通知でもあるジョブ(ID がカタログに一致)は、通知と同じ証拠を使う', () => {
    const notificationJobs: JobSpecModel = {
      available: true,
      catalog: {
        id: 'job-catalog',
        vocabulary: { kind: [{ id: 'notification' }], on_failure: [{ id: 'retry_then_dead_letter' }] },
        jobs: [
          {
            id: 'notify_entry_submitted',
            source: 'outbox',
            kind: 'notification',
            onFailure: 'retry_then_dead_letter',
            summary: '申込みを送る',
            location: { file: 'docs/specs/backend/jobs.md' },
          },
        ],
        // カタログ全体の整合テストは job-catalog 側にもあるが、通知側の規則が優先される
        // (このテストの主張点: job-catalog のこの証拠は使われない)。
        testCases: [tc('TC-JOB-CATALOG-001', ['job-catalog'])],
        location: { file: 'docs/specs/backend/jobs.md' },
      },
    };
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [submitSuccess], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      notifications,
      jobs: notificationJobs,
    };
    const rows = buildL2SweepRows(domainWithEffects(), ctx).filter((row) => row.section === 'ジョブ');

    expect(rows[0]?.evidence).toEqual([
      { id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', origin: 'derived' },
      { id: 'TC-NOTIFICATION-CATALOG-001', implementation: 'app/x.test.ts::TC-NOTIFICATION-CATALOG-001', origin: 'direct' },
    ]);
  });

  it('source: manual で通知でもあるジョブ(対外告知)は、通知でも直接のテストケースだけを見る(source が優先)', () => {
    const manualNotificationJobs: JobSpecModel = {
      available: true,
      catalog: {
        id: 'job-catalog',
        vocabulary: { kind: [{ id: 'notification' }], on_failure: [{ id: 'retry_then_dead_letter' }] },
        jobs: [
          {
            id: 'notify_entry_submitted',
            source: 'manual',
            kind: 'notification',
            onFailure: 'retry_then_dead_letter',
            summary: '人が送る告知',
            location: { file: 'docs/specs/backend/jobs.md' },
          },
        ],
        // 直接のテストケース(A13 が要求するもの)。
        testCases: [tc('TC-JOB-NOTIFY_ENTRY_SUBMITTED-001', ['notify_entry_submitted'])],
        location: { file: 'docs/specs/backend/jobs.md' },
      },
    };
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: { actions: [submitSuccess], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      notifications,
      jobs: manualNotificationJobs,
    };
    const rows = buildL2SweepRows(domainWithEffects(), ctx).filter((row) => row.section === 'ジョブ');

    // 遷移由来の導出も notification-catalog の直接クレジットも使わない —
    // source: manual 自身の直接のテストケースだけが証拠になる。
    expect(rows[0]?.evidence).toEqual([
      {
        id: 'TC-JOB-NOTIFY_ENTRY_SUBMITTED-001',
        implementation: 'app/x.test.ts::TC-JOB-NOTIFY_ENTRY_SUBMITTED-001',
        origin: 'direct',
      },
    ]);
  });
});

describe('rowsWithoutEvidence: 証拠 0 件の行の抽出(章末の一覧の元)', () => {
  it('グループを横断して、確認しているテストが 0 本の行だけを集める', () => {
    const ctx: GenerateContext = {
      ...GEN_CTX,
      actions: {
        actions: [
          actionSpec({
            handles: 'entry.submit',
            testCases: [testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] })],
          }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const rows = buildL2SweepRows(domain(), ctx);
    const missing = rowsWithoutEvidence(rows);

    // 成立だけ証拠あり。不成立 3 種(guard/invalid_from/forbidden)は 0 件で末尾行き。
    expect(missing).toHaveLength(3);
    expect(missing.every((row) => row.evidence.length === 0)).toBe(true);
    expect(missing.some((row) => row.aspect === '成立')).toBe(false);
  });
});
