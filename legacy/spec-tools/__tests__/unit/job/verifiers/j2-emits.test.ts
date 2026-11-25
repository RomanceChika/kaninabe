/**
 * J2 の続き(走査が積む通知の宣言 `emits` の接地)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   - emits の ID が `source: outbox` のジョブ行として宣言されていること(無い・別の軸の行は赤)
 *   - `kind` の語の `declares: [emits]` と行の `emits` が対であること
 *     (語を選んで書き忘れた行・emits を持つのに宣言の無い語を選んだ行のどちらも赤)
 *
 * モデルはテスト内でリテラル構築する(検証器のテストはファイル I/O を行わない)。
 */

import { describe, expect, it } from 'vitest';
import { verifyEmits } from '../../../../lib/job/verifiers/j2-emits.js';
import { jobModel, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** reminder を emits の宣言を持つ語として足した `kind` の語彙。 */
const REMINDER_KINDS = [{ id: 'notification' }, { id: 'scan' }, { id: 'reminder', declares: ['emits'] as const }];

describe('J2: 走査が積む通知(emits)の接地', () => {
  it('emits の ID が outbox の行として宣言されていれば違反なし', () => {
    const jobs = jobModel(
      [
        outboxJob('notify_performance_reminder'),
        scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
      ],
      true,
      REMINDER_KINDS,
    );

    expect(verifyEmits(jobs, TEST_ROOTS)).toEqual([]);
  });

  it('emits の ID がジョブカタログに無ければエラー', () => {
    const jobs = jobModel(
      [scheduledJob('remind_performances', { emits: ['notify_ghost'] }, { kind: 'reminder' })],
      true,
      REMINDER_KINDS,
    );

    const findings = verifyEmits(jobs, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('J2');
    expect(findings[0]?.message).toContain('notify_ghost がジョブカタログに無い種別です');
  });

  it('emits の ID が outbox でない行(manual)ならエラー(積まれる側ではない)', () => {
    const jobs = jobModel(
      [
        outboxJob('notify_public_x', { source: 'manual' }),
        scheduledJob('remind_performances', { emits: ['notify_public_x'] }, { kind: 'reminder' }),
      ],
      true,
      REMINDER_KINDS,
    );

    const findings = verifyEmits(jobs, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('source: manual の行で、走査が積む先(outbox)ではありません');
  });

  it('declares: [emits] の語を選んだのに emits が無い行はエラー(他に emits を持つ行が無くても)', () => {
    const jobs = jobModel([scheduledJob('remind_performances', {}, { kind: 'reminder' })], true, REMINDER_KINDS);

    const findings = verifyEmits(jobs, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('emits を必ず持つ語(declares)なのに、emits がありません');
  });

  it('emits を持つのに declares の無い語を選んだ行はエラー', () => {
    const jobs = jobModel(
      [
        outboxJob('notify_performance_reminder'),
        scheduledJob('scan_it', { emits: ['notify_performance_reminder'] }, { kind: 'scan' }),
      ],
      true,
      REMINDER_KINDS,
    );

    const findings = verifyEmits(jobs, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('emits を持つのに、kind scan が emits を declares していません');
  });

  it('カタログを読めていない(スキーマエラー)場合は何も言わない', () => {
    expect(verifyEmits({ available: true, catalog: null }, TEST_ROOTS)).toEqual([]);
  });
});
