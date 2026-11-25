/**
 * J1(ジョブカタログ ⇔ state_spec の effects の双方向閉世界)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   - effects の副作用が全部カタログにあれば違反なし
 *   - カタログから 1 行消すと赤(実装は積むのに仕様に無い)
 *   - effects に未登録の副作用を足すと赤(同上・逆から)
 *   - source: outbox なのに積む effects が無ければ赤(死んだ宣言)
 *   - source: schedule が effects から積まれていれば赤(軸の取り違え)
 *   - **N1 と違い接頭辞で母集合を切らない**(通知でない副作用も行を要求する)
 *   - **積む元は 2 つ**: effects のほかに、時刻で起きる走査の emits が積む outbox 行も死んだ宣言ではない
 */

import { describe, expect, it } from 'vitest';
import { verifyJobEffectParity } from '../../../../lib/job/verifiers/j1-effect-parity.js';
import { accessSpec, aggregate, effect, machine, specModel, write } from '../../../helpers/model-builder.js';
import { jobModel, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** entry.submit が副作用を宣言している最小ドメインモデル。 */
function domain(dos: readonly string[] = ['notify_organizer_new_entry']) {
  return specModel([
    aggregate('entry', {
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          effects: [effect('submit', dos)],
        }),
      ],
    }),
  ]);
}

describe('J1: ジョブカタログ ⇔ effects', () => {
  it('effects の副作用が全部カタログにあれば違反なし', () => {
    const catalog = jobModel([outboxJob('notify_organizer_new_entry')]);

    expect(verifyJobEffectParity(domain(), catalog, TEST_ROOTS)).toEqual([]);
  });

  it('カタログから 1 行消すとエラー(実装は積むのに仕様に無い)', () => {
    const catalog = jobModel([]);

    const findings = verifyJobEffectParity(domain(), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_organizer_new_entry');
    expect(findings[0]?.message).toContain('ジョブカタログにありません');
  });

  it('effects に未登録の副作用を足すとエラー', () => {
    const catalog = jobModel([outboxJob('notify_organizer_new_entry')]);

    const findings = verifyJobEffectParity(domain(['notify_organizer_new_entry', 'send_secret_webhook']), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('send_secret_webhook');
  });

  it('通知でない副作用もカタログの行を要求する(N1 と違い接頭辞で切らない)', () => {
    // notification_spec は `notify_` で母集合を切るが、ジョブカタログは
    // 「積まれうるもの」の全数を宣言するので create_member_account も行を持つ。
    const catalog = jobModel([outboxJob('notify_organizer_new_entry')]);

    const findings = verifyJobEffectParity(domain(['notify_organizer_new_entry', 'create_member_account']), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('create_member_account');
  });

  it('積む effects の無い outbox 行はエラー(死んだ宣言)', () => {
    const catalog = jobModel([outboxJob('notify_organizer_new_entry'), outboxJob('notify_nobody')]);

    const findings = verifyJobEffectParity(domain(), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_nobody');
    expect(findings[0]?.message).toContain('積む effects がありません');
  });

  it('source: schedule が effects から積まれていればエラー(軸の取り違え)', () => {
    const catalog = jobModel([scheduledJob('close_due_workshops')]);

    const findings = verifyJobEffectParity(domain(['close_due_workshops']), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('source: schedule なのに');
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(verifyJobEffectParity(domain(), { available: true, catalog: null }, TEST_ROOTS)).toEqual([]);
  });

  describe('writes[].effects(状態遷移を持たない編集の発火元)', () => {
    /** member.update(access_spec の writes)が refresh_session_profile を積む最小モデル。 */
    function domainWithWrites(effects: readonly string[] = ['refresh_session_profile']) {
      return specModel([
        aggregate('member', {
          access: accessSpec('member', {
            reads: [],
            writes: [write('account_owner', ['display_name'], undefined, effects)],
          }),
        }),
      ]);
    }

    it('writes[].effects の副作用がカタログにあれば違反なし', () => {
      const catalog = jobModel([outboxJob('refresh_session_profile')]);

      expect(verifyJobEffectParity(domainWithWrites(), catalog, TEST_ROOTS)).toEqual([]);
    });

    it('writes[].effects の副作用がカタログに無ければエラー(発火元は {entity}.update)', () => {
      const catalog = jobModel([]);

      const findings = verifyJobEffectParity(domainWithWrites(), catalog, TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('member.update');
      expect(findings[0]?.message).toContain('refresh_session_profile');
    });

    it('writes[].effects が source: manual を指していればエラー(effects からの投入と両立しない)', () => {
      const catalog = jobModel([outboxJob('refresh_session_profile', { source: 'manual' })]);

      const findings = verifyJobEffectParity(domainWithWrites(), catalog, TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('source: manual なのに member.update の effects');
    });

    it('writes[].effects だけで積まれていれば「積む effects が無い」エラーにはならない(state_spec の effects は空でよい)', () => {
      const catalog = jobModel([outboxJob('refresh_session_profile')]);

      expect(verifyJobEffectParity(domainWithWrites(), catalog, TEST_ROOTS)).toEqual([]);
    });
  });

  it('effects が積まなくても、走査の emits が積む outbox 行は死んだ宣言ではない', () => {
    const catalog = jobModel([
      outboxJob('notify_organizer_new_entry'),
      outboxJob('notify_performance_reminder'),
      scheduledJob('remind_performances', { emits: ['notify_performance_reminder'] }, { kind: 'reminder' }),
    ]);

    expect(verifyJobEffectParity(domain(), catalog, TEST_ROOTS)).toEqual([]);
  });

  it('走査が emits で積み直す outbox 行は effects からも積まれ続けてよい', () => {
    const catalog = jobModel([
      outboxJob('notify_organizer_new_entry'),
      scheduledJob('remind_entries', { emits: ['notify_organizer_new_entry'] }, { kind: 'reminder' }),
    ]);

    expect(verifyJobEffectParity(domain(), catalog, TEST_ROOTS)).toEqual([]);
  });

  it('どの走査の emits にも載らない outbox 行の指摘は、emits という出口も案内する', () => {
    const catalog = jobModel([outboxJob('notify_organizer_new_entry'), outboxJob('notify_nobody')]);

    const findings = verifyJobEffectParity(domain(), catalog, TEST_ROOTS);

    expect(findings[0]?.suggestion).toContain('emits');
  });
});
