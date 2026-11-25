/**
 * 通知の章に「積むジョブが失敗したとき」が添えられていること(束 ブック ⑧-c2。外部レビュー の指摘 P2)。
 *
 * 通知を送るジョブ(通知カタログと同じ ID のジョブ)は、ジョブの章の公理に数えない(通知の章が同じ事実を読む)。
 * ただし失敗したときの方針(やり直す・飛ばす)は通知の側に無いので、通知の章の行に併記する。
 * **同じ 1 単位の中の 1 行なので、公理の本数は増えない**。
 */

import { describe, expect, it } from 'vitest';
import { chapterReading } from '../../../../../lib/generate/render/book/block-reading.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { jobModel, outboxJob, scheduledJob } from '../../../../helpers/job-builder.js';
import { notification, notificationModel } from '../../../../helpers/notification-builder.js';

const WORDS = '積むジョブが失敗したとき';

/** 通知 3 本(積むジョブが 2 本・無いのが 1 本)の文脈。ジョブは渡さない版も作れる。 */
function ctxOf(withJobs: boolean): ReturnType<typeof bookCtx> {
  return {
    ...bookCtx(),
    notifications: notificationModel([notification('notify_a'), notification('notify_b'), notification('notify_c', { trigger: 'manual', mention: 'none' })]),
    jobs: withJobs
      ? jobModel([
          outboxJob('notify_a'),
          outboxJob('notify_b', { onFailure: 'skip_and_next_run' }),
          // 時刻で起きるジョブは、同じ ID でも「積む」ジョブではない(走査は自分で宣言する)。
          scheduledJob('notify_c', { cron: '0 19 * * *' }),
        ])
      : { available: true, catalog: null },
    humanFaceChapters: 'all',
  };
}

/** 章の本文(HTML の章を読む字にしたもの)。 */
function chapter(withJobs: boolean): string {
  return pageText(bookHtmlPage(bookModel(), ctxOf(withJobs), 'notifications.html') ?? '');
}

describe('通知の行に、積むジョブの失敗したときの方針を添える', () => {
  const content = chapter(true);

  it('積むジョブがある通知にだけ、語を添える。積むジョブが無い通知とスケジュールのジョブには添えない', () => {
    expect(content.split(WORDS)).toHaveLength(3);
    expect(content).toContain(`${WORDS}: retry_then_dead_letter`);
    expect(content).toContain(`${WORDS}: skip_and_next_run`);
  });

  it('ジョブのカタログを読めていないときは、添えない(例外も投げない)', () => {
    expect(chapter(false)).not.toContain(WORDS);
  });

  it('公理の本数は増えない: 添えても添えなくても、章の必読は同じ', () => {
    const file = 'docs/book/notifications.md';

    expect(chapterReading(bookModel(), ctxOf(true), file).axioms).toBe(chapterReading(bookModel(), ctxOf(false), file).axioms);
    expect(content).toContain('公理 6 本。通知 3 本、宛先の語 2、メンションの語 1');
  });
});
