/**
 * J0(ジョブカタログのスキーマ適合)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §共通形式・§1 行が宣言すること):
 *   - 正しいカタログが読めること
 *   - id が job-catalog 固定であること
 *   - ジョブ ID がスネークケースであること・重複しないこと
 *   - **kind / on_failure の値が、同じファイルが宣言した語彙に閉じていること**
 *   - source がフレームワーク固定の値域にあること
 *   - **軸ごとに書けるキーが違うこと**(outbox の行に時刻の宣言を書かせない)
 *   - schedule と not_scheduled_reason が排他で必ずどちらか・endpoint の要否
 *   - **scheduler(host / database)が値域であり、schedule の行に必須であること**
 *   - **`kind` の語の `in_transaction`(その語の行は書き込みと同じトランザクションで実現される)が
 *     行へ写ること・`kind` の語だけが宣言でき・outbox の行だけがその語を使えること**
 *   - **`kind` の語の `declares`(その語の行が必ず持つキー)が語へ読まれること・`kind` の語だけが宣言でき・
 *     書けるキーの値域に閉じ・重複・空が落ち・outbox の行だけがその語を使えること**
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseJobCatalog } from '../../../../lib/model/job/parse-jobs.js';

/** 最小の語彙(テストごとに上書きする)。 */
const VOCABULARY = {
  kind: [{ id: 'notification', label: '通知の送信' }, { id: 'scan' }],
  on_failure: [{ id: 'retry_then_dead_letter', means: 'retry_to_dead' }, { id: 'skip_and_next_run', means: 'next_run' }],
};

/** 1 行分の正しい outbox 宣言。 */
const OUTBOX_ROW = {
  id: 'notify_staff_member_left',
  source: 'outbox',
  kind: 'notification',
  on_failure: 'retry_then_dead_letter',
  summary: 'メンバーが退会したことを運営スタッフへ送る',
};

/** 1 行分の正しい schedule 宣言。 */
const SCHEDULE_ROW = {
  id: 'close_due_workshops',
  source: 'schedule',
  kind: 'scan',
  schedule: '*/10 * * * *',
  endpoint: '/api/deadlines/run',
  implementation: 'app/src/operation/workshop/close_deadline.ts',
  fires: 'workshop.close_deadline',
  due_from: 'workshop.entry_deadline',
  scheduler: 'database',
  on_failure: 'skip_and_next_run',
  summary: '締切時刻を過ぎた催しを締め切る',
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'job_spec',
    scope: 'backend',
    id: 'job-catalog',
    vocabulary: VOCABULARY,
    jobs: [OUTBOX_ROW, SCHEDULE_ROW],
    test_cases: [
      {
        id: 'TC-JOB-CATALOG-001',
        type: 'unit',
        covers: ['success'],
        spec_ids: ['job-catalog'],
        implementation: 'app/src/operation/__tests__/jobs/job-catalog.test.ts::カタログとハンドラの突合',
      },
    ],
    ...overrides,
  };
}

/** パースして (カタログ, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/jobs.md');
  const result = parseJobCatalog(data, reporter);
  // parseJobCatalog は必ずカタログを返す(部分的に読み飛ばしても null にしない)。
  if (result.value === null) throw new Error('カタログを構築できませんでした');
  return { value: result.value, findings: result.findings };
}

describe('J0: ジョブカタログのスキーマ', () => {
  it('正しいカタログが違反なく読める', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value.jobs.map((decl) => decl.id)).toEqual(['notify_staff_member_left', 'close_due_workshops']);
    expect(value.jobs[1]?.schedule).toEqual({
      cron: '*/10 * * * *',
      endpoint: '/api/deadlines/run',
      implementation: 'app/src/operation/workshop/close_deadline.ts',
      fires: 'workshop.close_deadline',
      dueFrom: 'workshop.entry_deadline',
      scheduler: 'database',
    });
  });

  it('id が job-catalog 以外なら違反', () => {
    const { findings } = parse(frontmatter({ id: 'jobs' }));

    expect(findings.map((finding) => finding.message)).toContain('id jobs はカタログの id ではありません');
  });

  it('ジョブ ID がスネークケースでなければ違反', () => {
    const { value, findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, id: 'NotifyStaff' }] }));

    expect(findings).toHaveLength(1);
    expect(value.jobs).toEqual([]);
  });

  it('ジョブ ID が重複していれば違反', () => {
    const { findings } = parse(frontmatter({ jobs: [OUTBOX_ROW, OUTBOX_ROW] }));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ ID notify_staff_member_left が重複しています',
    );
  });

  it('kind が宣言された語彙に無ければ違反(語彙は体系側に持たない)', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, kind: 'webhook' }] }));

    expect(findings.map((finding) => finding.message)).toContain(
      'kind webhook は vocabulary.kind に宣言されていません',
    );
  });

  it('on_failure が宣言された語彙に無ければ違反', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, on_failure: 'ignore' }] }));

    expect(findings.map((finding) => finding.message)).toContain(
      'on_failure ignore は vocabulary.on_failure に宣言されていません',
    );
  });

  it('source が値域に無ければ違反', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, source: 'webhook' }] }));

    expect(findings.map((finding) => finding.message)).toContain(
      'source webhook は値域(outbox / schedule / manual)にありません',
    );
  });

  it('outbox の行に時刻の宣言が書かれていれば違反(軸の取り違え)', () => {
    const { findings } = parse(
      frontmatter({ jobs: [{ ...OUTBOX_ROW, schedule: '*/10 * * * *', endpoint: '/api/x' }] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('時刻の宣言(schedule / endpoint)が書かれています');
  });

  it('outbox の行は anonymizes(匿名化する集約)を持てる', () => {
    const { value, findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member' }] }));

    expect(findings).toEqual([]);
    expect(value.jobs[0]?.anonymizes).toBe('member');
  });

  it('anonymizes を書かない行は anonymizes のキーを持たない', () => {
    const { value } = parse(frontmatter());

    expect(value.jobs[0]).not.toHaveProperty('anonymizes');
  });

  it('anonymizes がスネークケースでなければ違反', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'Member Row' }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('anonymizes Member Row がスネークケースではありません');
  });

  it('anonymizes が文字列でなければ違反(行ごと落とす)', () => {
    const { value, findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 3 }, SCHEDULE_ROW] }));

    expect(findings).toHaveLength(1);
    expect(value.jobs.map((decl) => decl.id)).toEqual(['close_due_workshops']);
  });

  it('schedule の行に anonymizes が書かれていれば違反(匿名化は outbox の効果)', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...SCHEDULE_ROW, anonymizes: 'member' }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('outbox 専用の宣言(anonymizes)が書かれています');
  });

  it('manual の行に anonymizes が書かれていれば違反', () => {
    const { findings } = parse(
      frontmatter({ jobs: [{ ...OUTBOX_ROW, source: 'manual', anonymizes: 'member' }] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('manual のジョブ notify_staff_member_left に outbox 専用の宣言');
  });

  it('outbox の行は ends_sessions(セッションを終える集約)と platform_call(認証基盤の呼び出しを持つ RPC)を対で持てる', () => {
    const { value, findings } = parse(
      frontmatter({ jobs: [{ ...OUTBOX_ROW, ends_sessions: 'member', platform_call: 'revoke_auth_sessions' }] }),
    );

    expect(findings).toEqual([]);
    expect(value.jobs[0]).toMatchObject({ endsSessions: 'member', platformCall: 'revoke_auth_sessions' });
  });

  it('匿名化の行は platform_call を ends_sessions なしで持てる(A14-5)', () => {
    const result = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member', platform_call: 'erase_auth_identity' }] }));
    expect(result.findings).toEqual([]);
    expect(result.value?.jobs[0]).toMatchObject({ anonymizes: 'member', platformCall: 'erase_auth_identity' });
    expect(result.value?.jobs[0]?.endsSessions).toBeUndefined();
  });

  it('匿名化の行は platform_call の代わりに platform_job を持てる', () => {
    const result = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member', platform_job: 'erase_auth_account' }] }));
    expect(result.findings).toEqual([]);
    expect(result.value?.jobs[0]).toMatchObject({ anonymizes: 'member', platformJob: 'erase_auth_account' });
    expect(result.value?.jobs[0]).not.toHaveProperty('platformCall');
  });

  it('platform_call と platform_job の併記は違反(消す経路が決まらない)', () => {
    const bad = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member', platform_call: 'erase_it', platform_job: 'erase_auth_account' }] }));
    expect(bad.findings[0]?.message).toContain('platform_call と platform_job が両方');
  });

  it('platform_job がスネークケースでなければ違反', () => {
    const bad = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member', platform_job: 'Erase It' }] }));
    expect(bad.findings[0]?.message).toContain('platform_job Erase It がスネークケースではありません');
  });

  it('匿名化の行の platform_call がスネークケースでなければ違反(A14-5)', () => {
    const bad = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, anonymizes: 'member', platform_call: 'Erase It' }] }));
    expect(bad.findings[0]?.message).toContain('platform_call Erase It がスネークケースではありません');
  });

  it('ends_sessions を書かない行は 2 つのキーを持たない', () => {
    const { value } = parse(frontmatter());

    expect(value.jobs[0]).not.toHaveProperty('endsSessions');
    expect(value.jobs[0]).not.toHaveProperty('platformCall');
  });

  it('ends_sessions と platform_call は対で要る(片方だけなら行ごと落として違反)', () => {
    for (const [extra, missing] of [
      [{ ends_sessions: 'member' }, 'platform_call'],
      [{ platform_call: 'revoke_auth_sessions' }, 'ends_sessions'],
    ] as const) {
      const { value, findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, ...extra }, SCHEDULE_ROW] }));

      expect(findings.some((finding) => finding.message.includes(`${missing} がありません`)), missing).toBe(true);
      expect(value.jobs.map((decl) => decl.id)).toEqual([SCHEDULE_ROW.id]);
    }
  });

  it('ends_sessions / platform_call がスネークケースでなければ違反', () => {
    const bad = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, ends_sessions: 'Member Row', platform_call: 'revoke_auth_sessions' }] }));
    expect(bad.findings).toHaveLength(1);
    expect(bad.findings[0]?.message).toContain('ends_sessions Member Row がスネークケースではありません');

    const badCall = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, ends_sessions: 'member', platform_call: 'Revoke It' }] }));
    expect(badCall.findings).toHaveLength(1);
    expect(badCall.findings[0]?.message).toContain('platform_call Revoke It がスネークケースではありません');
  });

  it('schedule / manual の行に ends_sessions が書かれていれば違反(セッションを終えるのは outbox の効果)', () => {
    for (const row of [SCHEDULE_ROW, { ...OUTBOX_ROW, source: 'manual' }]) {
      const { findings } = parse(frontmatter({ jobs: [{ ...row, ends_sessions: 'member', platform_call: 'revoke_auth_sessions' }] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('セッションを終える宣言(ends_sessions / platform_call)が書かれています');
    }
  });

  it('kind の語の declares: [ends_sessions] は語へ読まれ、schedule の行がその語を選べば違反', () => {
    const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'end', declares: ['ends_sessions'] }] };
    const ok = parse(frontmatter({ vocabulary, jobs: [{ ...OUTBOX_ROW, id: 'end_it', kind: 'end', ends_sessions: 'member', platform_call: 'revoke_auth_sessions' }] }));

    expect(ok.findings).toEqual([]);
    expect(ok.value.vocabulary.kind.find((term) => term.id === 'end')?.declares).toEqual(['ends_sessions']);

    const misplaced = parse(frontmatter({ vocabulary, jobs: [{ ...SCHEDULE_ROW, kind: 'end' }] }));
    expect(misplaced.findings.some((finding) => finding.message.includes('declares: ends_sessions'))).toBe(true);
  });

  it('on_failure の語の means は語へ読まれる(値域は体系が固定する)', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value.vocabulary.on_failure.map((term) => term.means)).toEqual(['retry_to_dead', 'next_run']);
    expect(value.vocabulary.kind.find((term) => term.id === 'notification')).not.toHaveProperty('means');
  });

  it('on_failure の語は means を必ず宣言する(書き忘れは違反)', () => {
    const vocabulary = { ...VOCABULARY, on_failure: [{ id: 'retry_then_dead_letter' }, { id: 'skip_and_next_run', means: 'next_run' }] };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('means がありません');
    expect(findings[0]?.location.pointer).toBe('vocabulary.on_failure[0].means');
  });

  it('means が値域に無ければ違反(語の綴りは比べず、値域だけを固定する)', () => {
    const vocabulary = {
      ...VOCABULARY,
      on_failure: [{ id: 'retry_then_dead_letter', means: 'retry_forever' }, { id: 'skip_and_next_run', means: 'next_run' }],
    };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('on_failure の語 retry_then_dead_letter の means retry_forever は値域にありません');
  });

  it('means は on_failure の語だけが宣言できる(kind の語に書けば違反)', () => {
    const vocabulary = { ...VOCABULARY, kind: [{ id: 'notification', means: 'retry_to_dead' }, { id: 'scan' }] };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('kind の語 notification に means が書かれています');
  });

  it('kind の語の in_transaction は、その語を選んだ行へ写る(行には書かない)', () => {
    const vocabulary = {
      ...VOCABULARY,
      kind: [...VOCABULARY.kind, { id: 'realized_in_rpc', in_transaction: true }, { id: 'plain', in_transaction: false }],
    };
    const { value, findings } = parse(
      frontmatter({
        vocabulary,
        jobs: [
          { ...OUTBOX_ROW, id: 'realized', kind: 'realized_in_rpc' },
          { ...OUTBOX_ROW, id: 'queued' },
          { ...OUTBOX_ROW, id: 'declared_false', kind: 'plain' },
        ],
      }),
    );

    expect(findings).toEqual([]);
    expect(value.vocabulary.kind.find((term) => term.id === 'realized_in_rpc')?.inTransaction).toBe(true);
    expect(value.vocabulary.kind.find((term) => term.id === 'plain')).not.toHaveProperty('inTransaction');
    expect(value.jobs.map((decl) => decl.inTransaction)).toEqual([true, undefined, undefined]);
  });

  describe('realized_by（効果を実現する RPC の名指し）', () => {
    const IN_TX = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'realized_in_rpc', in_transaction: true }] };
    const IN_TX_ROW = { ...OUTBOX_ROW, id: 'revoke_member_sessions', kind: 'realized_in_rpc', on_failure: 'retry_then_dead_letter' };

    it('同一トランザクションで実現される行は、イベント ID → RPC 名の写像として読める', () => {
      const realized = { 'membership.leave': 'apply_member_transition', 'membership.erase': 'erase_member' };
      const { value, findings } = parse(frontmatter({ vocabulary: IN_TX, jobs: [{ ...IN_TX_ROW, realized_by: realized }] }));

      expect(findings).toEqual([]);
      expect(value.jobs[0]?.realizedBy).toEqual(realized);
    });

    it('書かない行は realizedBy のキーを持たない（必須かどうかは T19 が見る）', () => {
      const { value, findings } = parse(frontmatter({ vocabulary: IN_TX, jobs: [IN_TX_ROW] }));

      expect(findings).toEqual([]);
      expect(value.jobs[0]).not.toHaveProperty('realizedBy');
    });

    it('キューに積まれる行（in_transaction でない語）に書けば違反（行ごと落ちる）', () => {
      const { value, findings } = parse(frontmatter({ jobs: [{ ...OUTBOX_ROW, realized_by: { 'a.b': 'rpc_x' } }] }));

      expect(findings.map((finding) => finding.message).join('\n')).toContain('realized_by が書かれていますが');
      expect(value.jobs).toEqual([]);
    });

    it('空の写像・イベント ID でないキー・スネークケースでない RPC 名は違反', () => {
      for (const bad of [{}, { leave: 'rpc_x' }, { 'a.b': 'Rpc X' }]) {
        const { value, findings } = parse(frontmatter({ vocabulary: IN_TX, jobs: [{ ...IN_TX_ROW, realized_by: bad }] }));
        expect(findings.length, JSON.stringify(bad)).toBeGreaterThan(0);
        expect(value.jobs, JSON.stringify(bad)).toEqual([]);
      }
    });
  });

  it('in_transaction は kind の語だけが宣言できる(on_failure の語に書けば違反)', () => {
    const vocabulary = {
      ...VOCABULARY,
      on_failure: [{ id: 'retry_then_dead_letter', means: 'retry_to_dead', in_transaction: true }, { id: 'skip_and_next_run', means: 'next_run' }],
    };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('on_failure の語 retry_then_dead_letter に in_transaction が書かれています');
  });

  it('in_transaction の語を schedule / manual の行が選べば違反(同一トランザクションで実現されるのは outbox の効果だけ)', () => {
    const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'realized_in_rpc', in_transaction: true }] };
    for (const row of [
      { ...SCHEDULE_ROW, kind: 'realized_in_rpc' },
      { ...OUTBOX_ROW, source: 'manual', kind: 'realized_in_rpc' },
    ]) {
      const { value, findings } = parse(frontmatter({ vocabulary, jobs: [row] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('書き込みと同じトランザクションで実現される語(in_transaction)です');
      expect(value.jobs).toEqual([]);
    }
  });

  it('in_transaction が真偽値でなければ違反', () => {
    const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'realized_in_rpc', in_transaction: 'yes' }] };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings.some((finding) => finding.message.includes('in_transaction'))).toBe(true);
  });

  it('kind の語の declares は語へ読まれる(宣言が無い語は持たない)', () => {
    const vocabulary = {
      ...VOCABULARY,
      kind: [...VOCABULARY.kind, { id: 'scrub', declares: ['anonymizes'] }],
    };
    const { value, findings } = parse(
      frontmatter({ vocabulary, jobs: [{ ...OUTBOX_ROW, id: 'scrub_it', kind: 'scrub', anonymizes: 'member' }] }),
    );

    expect(findings).toEqual([]);
    expect(value.vocabulary.kind.find((term) => term.id === 'scrub')?.declares).toEqual(['anonymizes']);
    expect(value.vocabulary.kind.find((term) => term.id === 'notification')).not.toHaveProperty('declares');
  });

  it('declares は kind の語だけが宣言できる(on_failure の語に書けば違反)', () => {
    const vocabulary = {
      ...VOCABULARY,
      on_failure: [{ id: 'retry_then_dead_letter', means: 'retry_to_dead', declares: ['anonymizes'] }, { id: 'skip_and_next_run', means: 'next_run' }],
    };
    const { findings } = parse(frontmatter({ vocabulary }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('on_failure の語 retry_then_dead_letter に declares が書かれています');
  });

  it('declares に書けるのは宣言できるキーだけ・重複と空は違反', () => {
    for (const [declares, expected] of [
      [['summary'], '宣言できるキーではありません'],
      [['anonymizes', 'anonymizes'], '重複しています'],
      [[], 'declares が空です'],
    ] as const) {
      const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'scrub', declares }] };
      const { findings } = parse(frontmatter({ vocabulary }));

      expect(findings.some((finding) => finding.message.includes(expected))).toBe(true);
    }
  });

  it('declares を持つ語を schedule / manual の行が選べば違反(そのキーを持てるのは outbox の行だけ)', () => {
    const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'scrub', declares: ['anonymizes'] }] };
    for (const row of [
      { ...SCHEDULE_ROW, kind: 'scrub' },
      { ...OUTBOX_ROW, source: 'manual', kind: 'scrub' },
    ]) {
      const { value, findings } = parse(frontmatter({ vocabulary, jobs: [row] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('行が必ず持つキー(declares: anonymizes)を宣言する語です');
      expect(value.jobs).toEqual([]);
    }
  });

  it('schedule の行は emits(走査が積む通知の ID の一覧)を持てる', () => {
    const { value, findings } = parse(
      frontmatter({ jobs: [{ ...SCHEDULE_ROW, emits: ['notify_a', 'notify_b'] }] }),
    );

    expect(findings).toEqual([]);
    expect(value.jobs[0]?.schedule?.emits).toEqual(['notify_a', 'notify_b']);
  });

  it('emits を書かない行は emits のキーを持たない', () => {
    const { value } = parse(frontmatter());

    expect(value.jobs[1]?.schedule).not.toHaveProperty('emits');
  });

  it('emits は 1 件以上・スネークケース・重複なし(空・形違い・重複は行ごと落とす)', () => {
    for (const [emits, message] of [
      [[], 'emits'],
      [['Notify-A'], 'スネークケースではありません'],
      [['notify_a', 'notify_a'], '重複しています'],
    ] as const) {
      const { value, findings } = parse(frontmatter({ jobs: [{ ...SCHEDULE_ROW, emits }] }));

      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.message).toContain(message);
      expect(value.jobs).toEqual([]);
    }
  });

  it('outbox / manual の行に emits が書かれていれば違反(積む通知を宣言できるのは時刻で起きる走査だけ)', () => {
    for (const row of [
      { ...OUTBOX_ROW, emits: ['notify_a'] },
      { ...OUTBOX_ROW, source: 'manual', emits: ['notify_a'] },
    ]) {
      const { value, findings } = parse(frontmatter({ jobs: [row] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('emits');
      expect(value.jobs).toEqual([]);
    }
  });

  it('declares: [emits] を持つ語は schedule の行だけが選べる(outbox / manual の行が選べば違反)', () => {
    const vocabulary = { ...VOCABULARY, kind: [...VOCABULARY.kind, { id: 'reminder', declares: ['emits'] }] };

    const ok = parse(frontmatter({ vocabulary, jobs: [{ ...SCHEDULE_ROW, kind: 'reminder', emits: ['notify_a'] }] }));
    expect(ok.findings).toEqual([]);
    expect(ok.value.vocabulary.kind.find((term) => term.id === 'reminder')?.declares).toEqual(['emits']);

    for (const row of [
      { ...OUTBOX_ROW, kind: 'reminder' },
      { ...OUTBOX_ROW, source: 'manual', kind: 'reminder' },
    ]) {
      const { value, findings } = parse(frontmatter({ vocabulary, jobs: [row] }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('行が必ず持つキー(declares: emits)を宣言する語です');
      expect(findings[0]?.suggestion).toContain('schedule の行だけ');
      expect(value.jobs).toEqual([]);
    }
  });

  it('schedule の行に implementation が無ければ違反', () => {
    const row = { ...SCHEDULE_ROW };
    delete (row as Record<string, unknown>)['implementation'];
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings.map((finding) => finding.message)).toContain('implementation がありません');
  });

  it('schedule も not_scheduled_reason も無ければ違反(いつ起きるか誰も知らない)', () => {
    const row = { ...SCHEDULE_ROW };
    delete (row as Record<string, unknown>)['schedule'];
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('schedule も not_scheduled_reason もありません');
  });

  it('schedule と not_scheduled_reason の両方があれば違反', () => {
    const { findings } = parse(
      frontmatter({ jobs: [{ ...SCHEDULE_ROW, not_scheduled_reason: 'まだ結線していない' }] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('両方があります');
  });

  it('cron を持つのに endpoint が無ければ違反(Cron の登録と突き合わせられない)', () => {
    const row = { ...SCHEDULE_ROW };
    delete (row as Record<string, unknown>)['endpoint'];
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('endpoint がありません');
  });

  it('scheduler が無ければ違反(schedule / not_scheduled_reason のどちらの行も必須)', () => {
    const row = { ...SCHEDULE_ROW };
    delete (row as Record<string, unknown>)['scheduler'];
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings.map((finding) => finding.message)).toContain('scheduler がありません');
  });

  it('scheduler が値域に無ければ違反(未知の値)', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...SCHEDULE_ROW, scheduler: 'cloudflare_cron' }] }));

    expect(findings.map((finding) => finding.message)).toContain(
      'ジョブ close_due_workshops の scheduler cloudflare_cron は値域(host / database)にありません',
    );
  });

  it('旧いキー runner は受けない(書き直し先を名指して違反。scheduler があっても二重には受けない)', () => {
    const row = { ...SCHEDULE_ROW, runner: 'pg_cron' };
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('ジョブ close_due_workshops の runner は廃止されました(鳴る場所は scheduler で書きます)');
    expect(findings[0]?.suggestion).toContain('`scheduler: host | database` に書き直す。`vercel_cron` → `host`・`pg_cron` → `database`');
  });

  it.each([
    ['outbox', OUTBOX_ROW],
    ['manual', { ...OUTBOX_ROW, id: 'rerun_by_hand', source: 'manual' }],
  ])('%s の行に旧いキー runner が書かれていれば違反(schedule の行と同じく黙って通さない)', (source, base) => {
    const { findings } = parse(frontmatter({ jobs: [{ ...base, runner: 'pg_cron' }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(`${source} のジョブ ${base.id} に廃止されたキー runner が書かれています`);
    expect(findings[0]?.suggestion).toContain('`scheduler: host | database` に書き直す');
    expect(findings[0]?.suggestion).toContain('schedule 以外の行には書かない');
  });

  it('旧い値の引き当ては自前の表だけ(constructor 等の継承されたプロパティを旧い値と取り違えない)', () => {
    const { findings } = parse(frontmatter({ jobs: [{ ...SCHEDULE_ROW, scheduler: 'constructor' }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('ジョブ close_due_workshops の scheduler constructor は値域(host / database)にありません');
    expect(findings[0]?.suggestion).toContain('host(アプリを動かす場所の Cron が叩く');
    expect(findings[0]?.suggestion).not.toContain('native code');
    expect(findings[0]?.suggestion).not.toContain('に書き直す');
  });

  it.each([
    ['vercel_cron', 'host'],
    ['pg_cron', 'database'],
  ])('旧い値 %s は受けない(%s に書き直すと名指して違反)', (retired, renamed) => {
    const { findings } = parse(frontmatter({ jobs: [{ ...SCHEDULE_ROW, scheduler: retired }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(`ジョブ close_due_workshops の scheduler ${retired} は値域(host / database)にありません`);
    expect(findings[0]?.suggestion).toContain(`${retired} は ${renamed} に`);
  });

  it('まだ結線していないジョブも scheduler を必須で持つ', () => {
    const row = { ...SCHEDULE_ROW, not_scheduled_reason: 'Bot の運用設定と同時に結線する' };
    delete (row as Record<string, unknown>)['schedule'];
    delete (row as Record<string, unknown>)['endpoint'];
    delete (row as Record<string, unknown>)['scheduler'];
    const { findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings.map((finding) => finding.message)).toContain('scheduler がありません');
  });

  it('まだ結線していないジョブは理由つきで宣言できる', () => {
    const row = { ...SCHEDULE_ROW, not_scheduled_reason: 'Bot の運用設定と同時に結線する' };
    delete (row as Record<string, unknown>)['schedule'];
    delete (row as Record<string, unknown>)['endpoint'];
    const { value, findings } = parse(frontmatter({ jobs: [row] }));

    expect(findings).toEqual([]);
    expect(value.jobs[0]?.schedule?.notScheduledReason).toBe('Bot の運用設定と同時に結線する');
  });

  it('vocabulary が無ければ違反', () => {
    const { findings } = parse(frontmatter({ vocabulary: undefined }));

    expect(findings.map((finding) => finding.message)).toContain('vocabulary がありません');
  });

  it('vocabulary の語が重複していれば違反', () => {
    const { findings } = parse(
      frontmatter({ vocabulary: { ...VOCABULARY, kind: [{ id: 'scan' }, { id: 'scan' }] } }),
    );

    expect(findings.map((finding) => finding.message)).toContain('kind の語 scan が重複しています');
  });
});
