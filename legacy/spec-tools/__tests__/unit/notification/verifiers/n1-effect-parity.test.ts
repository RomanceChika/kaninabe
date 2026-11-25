/**
 * N1(通知カタログ ⇔ state_spec の effects の双方向閉世界)のユニットテスト。
 *
 * 規約網羅(notification-spec-writing.md §検証):
 *   - effects の notify_* が全部カタログにあれば違反なし
 *   - カタログから 1 行消すと赤(実装は送るのに仕様に無い)
 *   - effects に未登録の notify_ を足すと赤(同上・逆から)
 *   - trigger: auto なのに発火する effects が無ければ赤(死んだ宣言)
 *   - trigger: manual が effects から自動発火されていれば赤
 *   - notify_ で始まらない副作用(create_member_account 等)はカタログを要求しない
 *   - **発火元の 3 つ目(走査の emits)**: trigger: schedule ⇔ emits の双方向・auto の積み直しは許す・
 *     schedule が effects に現れたら赤・manual が emits に現れたら赤・emits の通知がカタログに無ければ赤
 */

import { describe, expect, it } from 'vitest';
import { verifyEffectParity } from '../../../../lib/notification/verifiers/n1-effect-parity.js';
import { accessSpec, aggregate, effect, machine, specModel, write } from '../../../helpers/model-builder.js';
import { notification, notificationModel } from '../../../helpers/notification-builder.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { JobCatalogSpec } from '../../../../lib/model/job/types.js';
import { jobCatalog, loadedJobs, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { blockedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 走査を 1 本も宣言していないジョブカタログ。 */
const NO_JOBS = loadedJobs([]);

/** entry.submit と invitation.accept が副作用を宣言している最小ドメインモデル。 */
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

describe('N1: 通知カタログ ⇔ effects', () => {
  it('effects の通知が全部カタログにあれば違反なし', () => {
    const catalog = notificationModel([notification('notify_organizer_new_entry')]);

    expect(verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS)).toEqual([]);
  });

  it('カタログから 1 行消すとエラー(実装は送るのに仕様に無い)', () => {
    const catalog = notificationModel([]);

    const findings = verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_organizer_new_entry');
    expect(findings[0]?.message).toContain('通知カタログにありません');
  });

  it('effects に未登録の通知を足すとエラー', () => {
    const catalog = notificationModel([notification('notify_organizer_new_entry')]);

    const findings = verifyEffectParity(domain(['notify_organizer_new_entry', 'notify_staff_secret']), catalog, NO_JOBS, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_staff_secret');
  });

  it('trigger: auto なのに発火する effects が無ければエラー', () => {
    const catalog = notificationModel([
      notification('notify_organizer_new_entry'),
      notification('notify_nobody_fires_me'),
    ]);

    const findings = verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_nobody_fires_me');
    expect(findings[0]?.message).toContain('発火する effects がありません');
  });

  it('trigger: manual は effects に現れなければ違反なし', () => {
    const catalog = notificationModel([
      notification('notify_organizer_new_entry'),
      notification('notify_final_announcement', { trigger: 'manual' }),
    ]);

    expect(verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS)).toEqual([]);
  });

  it('trigger: manual が effects から自動発火されていればエラー', () => {
    const catalog = notificationModel([
      notification('notify_organizer_new_entry', { trigger: 'manual' }),
    ]);

    const findings = verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('自動発火');
  });

  it('notify_ で始まらない副作用はカタログを要求しない', () => {
    const catalog = notificationModel([notification('notify_organizer_new_entry')]);

    const findings = verifyEffectParity(domain(['notify_organizer_new_entry', 'create_member_account']), catalog, NO_JOBS, TEST_ROOTS);

    expect(findings).toEqual([]);
  });

  it('カタログを読めていない(スキーマエラー)場合は何も言わない', () => {
    const findings = verifyEffectParity(domain(), { available: true, catalog: null }, NO_JOBS, TEST_ROOTS);

    expect(findings).toEqual([]);
  });

  describe('writes[].effects(状態遷移を持たない編集の発火元)', () => {
    /** notify_ 接頭辞の効果を writes[].effects から積む最小モデル。 */
    function domainWithWrites(effectId: string) {
      return specModel([
        aggregate('member', {
          access: accessSpec('member', {
            reads: [],
            writes: [write('account_owner', ['display_name'], undefined, [effectId])],
          }),
        }),
      ]);
    }

    it('notify_ で始まる writes[].effects もカタログに要求する(発火元は {entity}.update)', () => {
      const findings = verifyEffectParity(domainWithWrites('notify_profile_changed'), notificationModel([]), NO_JOBS, TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('member.update');
      expect(findings[0]?.message).toContain('notify_profile_changed');
    });

    it('notify_ で始まらない writes[].effects はカタログを要求しない', () => {
      const findings = verifyEffectParity(domainWithWrites('refresh_session_profile'), notificationModel([]), NO_JOBS, TEST_ROOTS);

      expect(findings).toEqual([]);
    });
  });

  describe('走査の emits(通知の発火元の 3 つ目)', () => {
    /** 通知 id を emits で積む時刻起点の走査 1 本だけを持つジョブカタログ。 */
    function scanning(...emitted: readonly string[]) {
      return loadedJobs([scheduledJob('remind_performances', { emits: emitted }, { kind: 'reminder' })]);
    }

    it('trigger: schedule の通知を走査が emits で積んでいれば違反なし(effects には現れない)', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry'),
        notification('notify_performance_reminder', { trigger: 'schedule' }),
      ]);

      expect(
        verifyEffectParity(domain(), catalog, scanning('notify_performance_reminder'), TEST_ROOTS),
      ).toEqual([]);
    });

    it('trigger: schedule を積む走査が無ければエラー(死んだ宣言)', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry'),
        notification('notify_performance_reminder', { trigger: 'schedule' }),
      ]);

      const findings = verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('notify_performance_reminder(trigger: schedule)');
      expect(findings[0]?.message).toContain('emits がありません');
    });

    it('trigger: schedule が effects から発火されていればエラー(auto との取り違え)', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry', { trigger: 'schedule' }),
      ]);

      const findings = verifyEffectParity(
        domain(),
        catalog,
        scanning('notify_organizer_new_entry'),
        TEST_ROOTS,
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('trigger: schedule なのに');
      expect(findings[0]?.message).toContain('effects から発火されています');
    });

    it('trigger: auto の通知を走査が emits で積み直すのは許す(effects は持ち続ける)', () => {
      const catalog = notificationModel([notification('notify_organizer_new_entry')]);

      expect(
        verifyEffectParity(domain(), catalog, scanning('notify_organizer_new_entry'), TEST_ROOTS),
      ).toEqual([]);
    });

    it('auto の通知は emits があっても effects が無ければ死んだ宣言のまま(emits は effects の代わりにならない)', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry'),
        notification('notify_nobody_fires_me'),
      ]);

      const findings = verifyEffectParity(
        domain(),
        catalog,
        scanning('notify_nobody_fires_me'),
        TEST_ROOTS,
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('発火する effects がありません');
    });

    it('trigger: manual の通知が emits で積まれていればエラー', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry'),
        notification('notify_final_announcement', { trigger: 'manual' }),
      ]);

      const findings = verifyEffectParity(
        domain(),
        catalog,
        scanning('notify_final_announcement'),
        TEST_ROOTS,
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('trigger: manual なのに走査');
      expect(findings[0]?.message).toContain('remind_performances');
    });

    it('emits が名指す ID がカタログに無ければエラー(通知でない効果も書けない)', () => {
      const catalog = notificationModel([notification('notify_organizer_new_entry')]);

      const findings = verifyEffectParity(domain(), catalog, scanning('notify_ghost'), TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('notify_ghost が通知カタログにありません');
    });

    describe('ジョブカタログが阻害のとき(走査の emits に依る判定は出さない)', () => {
      const catalog = notificationModel([
        notification('notify_organizer_new_entry'),
        notification('notify_performance_reminder', { trigger: 'schedule' }),
      ]);

      it('schedule の行を積む走査が見えなくても「emits がありません」と言わない(落とした走査かもしれない)', () => {
        const live = verifyEffectParity(domain(), catalog, NO_JOBS, TEST_ROOTS);
        expect(live.map((finding) => finding.message).join('\n')).toContain('emits がありません');

        for (const reason of ['invalid', 'missing', 'load-failed'] as const) {
          expect(verifyEffectParity(domain(), catalog, blockedInput(reason), TEST_ROOTS)).toEqual([]);
        }
      });

      it('走査に依らない判定(effects の通知がカタログにあるか・auto の行の死んだ宣言)は阻害でも出す', () => {
        const withoutRow = notificationModel([notification('notify_unfired')]);

        const findings = verifyEffectParity(domain(), withoutRow, blockedInput('invalid'), TEST_ROOTS);

        expect(findings.map((finding) => finding.message).join('\n')).toContain('notify_organizer_new_entry が通知カタログにありません');
        expect(findings.map((finding) => finding.message).join('\n')).toContain('notify_unfired(trigger: auto)を発火する effects がありません');
      });

      it('仕様を落とした阻害は、読めた走査の emits が未宣言の通知・manual の行を指すことを言う(真の検出)。積む走査が無いという判定は出さない', () => {
        const unreadable = (...emitted: readonly string[]): CatalogInput<JobCatalogSpec> => ({
          state: 'blocked',
          reason: 'invalid',
          findings: [],
          partial: jobCatalog([scheduledJob('remind_performances', { emits: emitted }, { kind: 'reminder' })]),
        });
        const withManual = notificationModel([notification('notify_organizer_new_entry'), notification('notify_digest', { trigger: 'manual' })]);

        const ghost = verifyEffectParity(domain(), catalog, unreadable('notify_ghost'), TEST_ROOTS);
        const manual = verifyEffectParity(domain(), withManual, unreadable('notify_digest'), TEST_ROOTS);

        expect(ghost.map((finding) => finding.message)).toEqual([expect.stringContaining('notify_ghost が通知カタログにありません')]);
        expect(manual.map((finding) => finding.message)).toEqual([expect.stringContaining('notify_digest は trigger: manual なのに走査')]);
        // 部分のモデルが無い阻害(読めない)は、emits の突合も出さない
        expect(verifyEffectParity(domain(), catalog, blockedInput('load-failed'), TEST_ROOTS)).toEqual([]);
      });

      it('採っていない(未選択)は走査が事実として無い — 従来どおり判定する', () => {
        expect(verifyEffectParity(domain(), catalog, UNSELECTED, TEST_ROOTS)).toHaveLength(1);
      });
    });

    it('同じ通知を積む走査が複数あっても 1 件の指摘にまとまる(走査の名が並ぶ)', () => {
      const catalog = notificationModel([notification('notify_organizer_new_entry')]);
      const jobs = loadedJobs([
        scheduledJob('scan_a', { emits: ['notify_ghost'] }, { kind: 'reminder' }),
        scheduledJob('scan_b', { emits: ['notify_ghost'] }, { kind: 'reminder' }),
        outboxJob('notify_ghost'),
      ]);

      const findings = verifyEffectParity(domain(), catalog, jobs, TEST_ROOTS);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('scan_a / scan_b');
    });
  });
});
