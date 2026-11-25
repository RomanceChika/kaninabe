/**
 * notification-body / code-notifications / book-notifications のユニットテスト。
 *
 * 生成は情報を足さない(カタログのマトリクスのみ)。ここでは差し込み先と、
 * **発火元イベントを effects から引いていること**(カタログに書き写していないこと)、
 * 語彙の型がカタログから作られること(体系側に語の一覧を持たないこと)を固定する。
 */

import { describe, expect, it } from 'vitest';
import { notificationBodyGenerator } from '../../../../lib/generate/render/notification-body.js';
import { notificationExpectationsGenerator } from '../../../../lib/generate/render/code-notifications.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { aggregate, effect, machine, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { notification, notificationModel } from '../../../helpers/notification-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** entry.submit が通知を 1 本宣言しているモデル。 */
function domain() {
  return specModel([
    aggregate('entry', {
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          effects: [effect('submit', ['notify_staff_member_left'])],
        }),
      ],
    }),
  ]);
}

/** 本人を名指す語(`mentions_person`)を足したカタログ(行は person_from を持つ)。 */
function personModel() {
  const base = notificationModel([
    notification('notify_staff_member_left', {
      mention: 'person',
      personFrom: { entity: 'entry', field: 'owner_id' },
    }),
  ]);
  const catalog = base.catalog;
  if (catalog === null) throw new Error('カタログが読めていません');
  return {
    ...base,
    catalog: {
      ...catalog,
      vocabulary: {
        ...catalog.vocabulary,
        mention: [{ id: 'none' }, { id: 'person', label: '本人', mentionsPerson: true }],
        audience: [{ id: 'staff_channel', label: 'チャンネル', recipient: { kind: 'channel' as const }, allowsPersonMention: true }],
      },
    },
  };
}

const CTX = (model: ReturnType<typeof notificationModel>) => ({
  guards: stubGuards(),
  roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
  notifications: model,
});

describe('notification-body', () => {
  it('カタログがマトリクスに写り、発火元イベントは effects から引かれる', () => {
    const sections = notificationBodyGenerator.generate(
      domain(),
      CTX(notificationModel([notification('notify_staff_member_left')])),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/notifications.md');
    expect(sections[0]?.marker).toBe('notification-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('`notify_staff_member_left`');
    expect(content).toContain('`entry.submit`');
    expect(content).toContain('### 語彙(このカタログが宣言する値域)');
  });

  it('trigger: manual の行は発火元を持たない', () => {
    const sections = notificationBodyGenerator.generate(
      domain(),
      CTX(
        notificationModel([
          notification('notify_staff_member_left'),
          notification('notify_final_announcement', { trigger: 'manual' }),
        ]),
      ),
    );

    expect(sections[0]?.content ?? '').toContain('—(人が送る)');
  });

  it('trigger: schedule の行は、積む走査が発火元として並ぶ(遷移のイベントとは区別される)', () => {
    const jobs = jobModel([
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
    ]);
    const sections = notificationBodyGenerator.generate(domain(), {
      ...CTX(notificationModel([notification('notify_performance_reminder', { trigger: 'schedule' })])),
      jobs,
    });

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `notify_performance_reminder` | schedule | 走査 `remind_performances` |');
  });

  it('本人を名指す語は語彙の表で注記され、行は person_from を添える', () => {
    const sections = notificationBodyGenerator.generate(domain(), CTX(personModel()));

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| メンション(mention) | `person` | 本人(本人を名指す。行に person_from が要る) |');
    expect(content).toContain('| 宛先(audience) | `staff_channel` | チャンネル(本人を名指すメンションと組める) |');
    expect(content).toContain('person ← `entry.owner_id`');
  });

  it('カタログが無ければ何も生成しない', () => {
    expect(notificationBodyGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

describe('code-notifications', () => {
  it('語彙の型はカタログから作られる(体系側に語の一覧を持たない)', () => {
    const sections = notificationExpectationsGenerator.generate(
      domain(),
      CTX(notificationModel([notification('notify_staff_member_left')])),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/notifications.ts');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = sections[0]?.content ?? '';
    expect(content).toContain("export type NotificationAudience = 'staff_channel' | 'member_dm';");
    expect(content).toContain("id: 'notify_staff_member_left',");
    // 突合の対象は 4 軸だが、`summary` は**送る文面の最小要素**として写す
    // (実装が文面を書き写すと仕様と二重管理になる。E6 第2段)。
    expect(content).toContain('summary:');
  });
});

describe('code-notifications(本人を名指す行)', () => {
  it('person_from のある行だけ personFrom を写し、型にも欄がある', () => {
    const sections = notificationExpectationsGenerator.generate(domain(), CTX(personModel()));

    const content = sections[0]?.content ?? '';
    expect(content).toContain("export type NotificationMention = 'none' | 'person';");
    expect(content).toContain('readonly personFrom?: { readonly entity: string; readonly field: string };');
    expect(content).toContain("entity: 'entry'");
    expect(content).toContain("field: 'owner_id'");
  });
});

/** 通知の章(HTML の本)のセクション。 */
const bookNotifications = (ctx: unknown) => bookChapterSections(domain(), ctx as Parameters<typeof bookChapterSections>[1], 'notifications.html');

describe('book-notifications(HTML の本の通知の章)', () => {
  it('章を丸ごと生成し、宛先の語彙を件数つきで添える', () => {
    const sections = bookNotifications(CTX(notificationModel([notification('notify_staff_member_left')])));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/notifications.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const html = sections[0]?.content ?? '';
    const content = pageText(html);
    expect(content).toContain('誰に何が飛ぶか(通知)');
    expect(content).toContain('宛先とメンションの語(');
    expect(html).toContain('<p class="bf-group">宛先の語<small>');
    expect(html).toContain('<p class="bf-group">メンションの語<small>');
  });

  it('trigger: schedule の行は発火元の列に積む走査が並ぶ(ブックでも遷移のイベントと区別される)', () => {
    const jobs = jobModel([
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
    ]);

    const sections = bookNotifications({
      ...CTX(notificationModel([notification('notify_performance_reminder', { trigger: 'schedule' })])),
      jobs,
    });

    const content = pageText(sections[0]?.content ?? '');
    expect(content).toContain('notify_performance_reminder | 走査 remind_performances');
    expect(content).toContain('時刻で起きる走査が積んだとき');
  });

  it('本人を名指す行は、メンションの列に person_from が添わる', () => {
    const sections = bookNotifications(CTX(personModel()));

    const content = pageText(sections[0]?.content ?? '');
    expect(content).toContain('person ← entry.owner_id');
    expect(content).toContain('特定の 1 人を名指す。行に person_from が要る');
  });

  it('カタログを開設していなければ章ごと生成しない', () => {
    expect(bookNotifications({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
