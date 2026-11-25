/**
 * job-body / code-jobs / book-jobs のユニットテスト。
 *
 * 生成は情報を足さない(カタログのマトリクスのみ)。ここでは差し込み先と、
 * **積む元イベントを effects から引いていること**(カタログに書き写していないこと)、
 * 語彙の型がカタログから作られること(体系側に語の一覧を持たないこと)、
 * そして**まだ Cron に登録していないジョブがその旨つきで出ること**を固定する。
 */

import { describe, expect, it } from 'vitest';
import { jobBodyGenerator } from '../../../../lib/generate/render/job-body.js';
import { jobExpectationsGenerator } from '../../../../lib/generate/render/code-jobs.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { aggregate, effect, machine, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** entry.submit がジョブを 1 本積むモデル。 */
function domain() {
  return specModel([
    aggregate('entry', {
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          effects: [effect('submit', ['notify_organizer_new_entry'])],
        }),
      ],
    }),
  ]);
}

const CTX = (model: ReturnType<typeof jobModel>) => ({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, jobs: model });

/** outbox 1 本 + schedule 1 本の標準的なカタログ。 */
function standard() {
  return jobModel([
    outboxJob('notify_organizer_new_entry'),
    scheduledJob('close_due_workshops', {
      fires: 'workshop.close_deadline',
      dueFrom: 'workshop.entry_deadline',
    }),
  ]);
}

describe('job-body', () => {
  it('カタログがマトリクスに写り、積む元イベントは effects から引かれる', () => {
    const sections = jobBodyGenerator.generate(domain(), CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/jobs.md');
    expect(sections[0]?.marker).toBe('job-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('`notify_organizer_new_entry`');
    expect(content).toContain('`entry.submit`');
    expect(content).toContain('### 語彙(このカタログが宣言する値域)');
  });

  it('語彙の表に、kind の語の in_transaction と declares の宣言が出る', () => {
    const base = standard();
    const model = {
      ...base,
      catalog: {
        ...base.catalog!,
        vocabulary: {
          ...base.catalog!.vocabulary,
          kind: [...base.catalog!.vocabulary.kind, { id: 'realized_in_rpc', label: 'RPC 内で実現', inTransaction: true, declares: ['anonymizes' as const] }],
        },
      },
    };

    const content = jobBodyGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content).toContain('| 軸 | 語 | 表示名 | 同一トランザクションで実現 | 行が必ず持つキー | 失敗の意味(means) |');
    expect(content).toContain('`realized_in_rpc` | RPC 内で実現 | in_transaction | `anonymizes` | — |');
    expect(content).toContain('`notification` | — | — | — | — |');
    // on_failure の語は、宣言した意味(体系が固定する値域)が出る
    expect(content).toContain('`retry_then_dead_letter` | — | — | — | `retry_to_dead` |');
  });

  it('時刻で起きるジョブは別の表になり、発火時刻の供給元まで出る', () => {
    const content = jobBodyGenerator.generate(domain(), CTX(standard()))[0]?.content ?? '';

    expect(content).toContain('### 時刻で起きるジョブ');
    expect(content).toContain('`*/10 * * * *`');
    expect(content).toContain('`workshop.entry_deadline`');
    expect(content).toContain('### 実装(実在も検査される)');
  });

  it('走査の emits は時刻の表の「積む通知」に出て、積まれる側の outbox 行の「積む元」に走査として並ぶ', () => {
    const model = jobModel([
      outboxJob('notify_performance_reminder'),
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
    ]);

    const content = jobBodyGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content).toContain('積む通知(emits)');
    expect(content).toMatch(/`remind_performances`.*`notify_performance_reminder`/);
    expect(content).toContain('走査 `remind_performances`');
    expect(content).toContain('積む元(イベント / 走査)');
  });

  it('まだ Cron に登録していないジョブは理由つきで出る', () => {
    const model = jobModel([notScheduledJob('detect_reachability', 'Bot の運用設定と同時に結線する')]);

    const content = jobBodyGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content).toContain('未登録: Bot の運用設定と同時に結線する');
  });

  it('カタログが無ければ何も生成しない', () => {
    expect(jobBodyGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

describe('code-jobs', () => {
  it('語彙の型はカタログから作られる(体系側に語の一覧を持たない)', () => {
    const sections = jobExpectationsGenerator.generate(domain(), CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/jobs.ts');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = sections[0]?.content ?? '';
    expect(content).toContain(
      "export type JobKind = 'notification' | 'transaction_effect' | 'scan';",
    );
    expect(content).toContain("export type JobSource = 'outbox' | 'schedule' | 'manual';");
  });

  it('突合の対象は 3 軸だけで、summary は写らない', () => {
    const content = jobExpectationsGenerator.generate(domain(), CTX(standard()))[0]?.content ?? '';

    expect(content).toContain("id: 'notify_organizer_new_entry'");
    expect(content).toContain("source: 'outbox'");
    expect(content).toContain("onFailure: 'retry_then_dead_letter'");
    expect(content).not.toContain('の説明');
  });

  it('走査が積む通知(emits)は時刻で起きる行だけが持つ(突合用の期待表に載る)', () => {
    const model = jobModel([
      outboxJob('notify_performance_reminder'),
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
      scheduledJob('close_due_workshops'),
    ]);

    const content = jobExpectationsGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content.match(/emits: \[/g)).toHaveLength(1);
    expect(content).toContain("'notify_performance_reminder'");
    expect(content).toContain('readonly emits?: readonly string[];');
  });

  it('匿名化する効果の行だけが anonymizes を持つ(kind の語との対を製品側のテストが縛れる)', () => {
    const model = jobModel([outboxJob('notify_organizer_new_entry'), outboxJob('scrub_person', { anonymizes: 'person' })]);

    const content = jobExpectationsGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content.match(/anonymizes: '/g)).toHaveLength(1); // 匿名化の行だけ(通知の行には載らない)
    expect(content).toContain("anonymizes: 'person'");
  });

  it('同一トランザクションで実現される効果の行だけが inTransaction を持つ(製品側のテストが語を知らずに引ける)', () => {
    const model = jobModel([outboxJob('notify_organizer_new_entry'), outboxJob('realize_in_rpc', { inTransaction: true })]);

    const content = jobExpectationsGenerator.generate(domain(), CTX(model))[0]?.content ?? '';

    expect(content.match(/inTransaction: true/g)).toHaveLength(1);
    expect(content).toContain('readonly inTransaction?: boolean;');
  });

  it('カタログが無ければ何も生成しない', () => {
    expect(jobExpectationsGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** ジョブの章(HTML の本)のセクション。 */
const bookJobs = (ctx: unknown) => bookChapterSections(domain(), ctx as Parameters<typeof bookChapterSections>[1], 'jobs.html');

describe('book-jobs(HTML の本のジョブの章)', () => {
  it('章は時刻で起きるものを先に、イベントで積まれるものを後に出す', () => {
    const sections = bookJobs(CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/jobs.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = pageText(sections[0]?.content ?? '');
    expect(content.indexOf('時刻で起きるジョブ(')).toBeLessThan(content.indexOf('イベントなどで積まれるジョブ('));
    expect(content).toContain('誰も見ていないときに何が動くか(ジョブ)');
    expect(content).toContain('失敗したときの語(');
  });

  it('走査が積む通知(emits)は時刻の表の「積む通知」と、積まれる側の「積む元」の走査に出る', () => {
    const model = jobModel([
      outboxJob('notify_performance_reminder'),
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
    ]);

    const content = pageText(bookJobs(CTX(model))[0]?.content ?? '');

    // 下段の「走査の実装と登録」の表に「積む通知」の列が出て、「積む元」の表では走査が元として出る。
    expect(content).toContain('積む通知');
    expect(content).toMatch(/remind_performances.*notify_performance_reminder/);
    expect(content).toContain('走査 remind_performances');
  });

  it('カタログが無ければ章そのものを出さない', () => {
    expect(bookJobs({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
