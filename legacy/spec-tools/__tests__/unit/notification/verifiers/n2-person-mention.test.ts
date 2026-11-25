/**
 * N2(本人を名指すメンション `person_from` の接地)のユニットテスト。
 *
 * 規約網羅(notification-spec-writing.md §本人を名指すメンション):
 *   - `person_from` が集約・欄に実在し、欄がメンバー(実行者の集約)への参照で、
 *     通知を起こした集約(effects の集約 / 走査の due_from の集約)の欄なら違反なし
 *   - 集約が無い・欄が無い・欄がメンバーへの参照でない・実行者の集約が無い・別の集約の欄、はそれぞれ赤
 *   - `person_from` を持たない通知は何も要求されない
 */

import { describe, expect, it } from 'vitest';
import { verifyPersonMention } from '../../../../lib/notification/verifiers/n2-person-mention.js';
import { aggregate, effect, entitySpec, field, machine, specModel } from '../../../helpers/model-builder.js';
import { notification, notificationModel } from '../../../helpers/notification-builder.js';
import { loadedJobs, scheduledJob } from '../../../helpers/job-builder.js';
import { blockedInput } from '../../../helpers/verify-inputs.js';

/** メンバー(実行者の集約。session: true の欄を持つ)・申込(メンバーへの参照の欄 owner_id と、参照でない欄 note)・催し。 */
function domain(dos: readonly string[], withActor = true) {
  return specModel([
    ...(withActor
      ? [
          aggregate('member', {
            entity: entitySpec('member', {
              fields: [field('id', { kind: 'uuid' }), field('display_name', { kind: 'string' }, { session: true })],
            }),
          }),
        ]
      : []),
    aggregate('entry', {
      entity: entitySpec('entry', {
        fields: [
          field('id', { kind: 'uuid' }),
          field('owner_id', { kind: 'ref', entity: 'member' }),
          field('note', { kind: 'string' }),
          field('workshop_id', { kind: 'ref', entity: 'workshop' }),
        ],
      }),
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          effects: [effect('submit', dos)],
        }),
      ],
    }),
    aggregate('workshop', {
      entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' }), field('owner_id', { kind: 'ref', entity: 'member' })] }),
    }),
  ]);
}

const NO_JOBS = loadedJobs([]);

/** 本人を名指す通知 1 本(person_from を指定)。 */
function person(personFrom: { entity: string; field: string }) {
  return notification('notify_owner', { personFrom });
}

describe('N2: 本人を名指すメンションの接地', () => {
  it('メンバーへの参照の欄で、通知を起こした集約の欄なら違反なし', () => {
    const catalog = notificationModel([person({ entity: 'entry', field: 'owner_id' })]);

    expect(verifyPersonMention(domain(['notify_owner']), catalog, NO_JOBS)).toEqual([]);
  });

  it('person_from を持たない通知は何も要求されない', () => {
    const catalog = notificationModel([notification('notify_owner')]);

    expect(verifyPersonMention(domain(['notify_owner'], false), catalog, NO_JOBS)).toEqual([]);
  });

  it('カタログが無ければ何も見ない', () => {
    expect(verifyPersonMention(domain([]), { available: false, catalog: null }, NO_JOBS)).toEqual([]);
  });

  it('集約が entity_spec に無ければエラー', () => {
    const catalog = notificationModel([person({ entity: 'ghost', field: 'owner_id' })]);

    const findings = verifyPersonMention(domain(['notify_owner']), catalog, NO_JOBS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('N2');
    expect(findings[0]?.message).toContain('集約 ghost が entity_spec にありません');
  });

  it('欄がその集約に無ければエラー', () => {
    const catalog = notificationModel([person({ entity: 'entry', field: 'nobody' })]);

    const findings = verifyPersonMention(domain(['notify_owner']), catalog, NO_JOBS);

    expect(findings[0]?.message).toContain('欄 nobody が entry にありません');
  });

  it('欄がメンバーへの参照でなければエラー(型が違う・別の集約への参照)', () => {
    const plain = notificationModel([person({ entity: 'entry', field: 'note' })]);
    const other = notificationModel([person({ entity: 'entry', field: 'workshop_id' })]);

    expect(verifyPersonMention(domain(['notify_owner']), plain, NO_JOBS)[0]?.message).toContain('メンバー(member)への参照ではありません');
    expect(verifyPersonMention(domain(['notify_owner']), other, NO_JOBS)[0]?.message).toContain('メンバー(member)への参照ではありません');
  });

  it('実行者の集約(session: true)が無ければエラー', () => {
    const catalog = notificationModel([person({ entity: 'entry', field: 'owner_id' })]);

    const findings = verifyPersonMention(domain(['notify_owner'], false), catalog, NO_JOBS);

    expect(findings[0]?.message).toContain('実行者の集約');
  });

  it('通知を起こす集約と別の集約の欄ならエラー(payload から辿れない)', () => {
    const catalog = notificationModel([person({ entity: 'workshop', field: 'owner_id' })]);

    const findings = verifyPersonMention(domain(['notify_owner']), catalog, NO_JOBS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('通知を起こす集約(entry)ではありません');
  });

  it('走査が積む通知は、走査の due_from の集約の欄なら違反なし・別の集約ならエラー', () => {
    const jobs = loadedJobs([scheduledJob('remind_owner', { dueFrom: 'workshop.starts_at', emits: ['notify_owner'] })]);
    const ok = notificationModel([notification('notify_owner', { trigger: 'schedule', personFrom: { entity: 'workshop', field: 'owner_id' } })]);
    const ng = notificationModel([notification('notify_owner', { trigger: 'schedule', personFrom: { entity: 'entry', field: 'owner_id' } })]);

    expect(verifyPersonMention(domain([]), ok, jobs)).toEqual([]);
    expect(verifyPersonMention(domain([]), ng, jobs)[0]?.message).toContain('通知を起こす集約(workshop)ではありません');
  });

  it('ジョブカタログが阻害なら走査の集約を数えない — effects の集約だけで突き合わせる(別の集約が見つかれば真の違反)', () => {
    const scanOnly = notificationModel([notification('notify_owner', { trigger: 'schedule', personFrom: { entity: 'entry', field: 'owner_id' } })]);
    const live = loadedJobs([scheduledJob('remind_owner', { dueFrom: 'workshop.starts_at', emits: ['notify_owner'] })]);
    // 走査の集約(workshop)と一致しない entry を指すので、読めていれば error。阻害なら走査が見えないので突き合わせない。
    expect(verifyPersonMention(domain([]), scanOnly, live)[0]?.message).toContain('通知を起こす集約(workshop)ではありません');
    expect(verifyPersonMention(domain([]), scanOnly, blockedInput('invalid'))).toEqual([]);
    expect(verifyPersonMention(domain([]), scanOnly, blockedInput('missing'))).toEqual([]);

    // effects の集約には依らない: 別の集約の欄を指せば、阻害でも真の違反として出る。
    const viaEffects = notificationModel([person({ entity: 'workshop', field: 'owner_id' })]);
    expect(verifyPersonMention(domain(['notify_owner']), viaEffects, blockedInput('invalid'))).toHaveLength(1);
  });

  it('発火元の集約が分からない通知(走査に due_from が無い)は集約の突き合わせをしない', () => {
    const jobs = loadedJobs([scheduledJob('remind_owner', { emits: ['notify_owner'] })]);
    const catalog = notificationModel([notification('notify_owner', { trigger: 'schedule', personFrom: { entity: 'entry', field: 'owner_id' } })]);

    expect(verifyPersonMention(domain([]), catalog, jobs)).toEqual([]);
  });
});
