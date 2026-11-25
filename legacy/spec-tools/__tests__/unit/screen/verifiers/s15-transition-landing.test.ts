/**
 * S15(遷移後の着地)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「navigations の on: T.success の行き先 P2 について、
 * T の to 状態で P2 の precondition が成り立ち、T の by のロールが P2 に入れる。
 * 満たさなければエラー(成功したのに not found へ飛ぶ)」。免除の器は無い。
 */

import { describe, expect, it } from 'vitest';
import { transitionLandingVerifier } from '../../../../lib/screen/verifiers/s15-transition-landing.js';
import { aggregate, entitySpec, event, field, machine, role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { screenInput, screenSpec, SCREEN_CTX } from '../../../helpers/screen-builder.js';

/** workshop(draft → published、by: organizer)を持つ最小ドメイン。 */
function domain() {
  return specModel({
    roles: [role('anonymous'), role('member'), role('organizer', undefined, ['member']), role('system')],
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [field('state', { kind: 'state', machine: 'workshop' })]),
        stateMachines: [
          machine({
            machine: 'workshop',
            states: ['draft', 'published'],
            events: [event({ id: 'publish', from: ['draft'], to: 'published', by: ['organizer'] })],
          }),
        ],
      }),
    ],
  });
}

describe('S15 遷移後の着地', () => {
  it('遷移後の状態を弾かず、by のロールが入れる画面へなら通る', () => {
    const from = screenSpec({
      name: 'workshop_manage',
      for: ['organizer'],
      actions: ['workshop.publish'],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-workshop-manage' }],
    });

    const findings = transitionLandingVerifier.verify(screenInput({ domain: domain(), screens: [from] }), SCREEN_CTX);
    expect(findings).toEqual([]);
  });

  it('行き先の precondition が遷移後の状態を弾けば失敗する', () => {
    const from = screenSpec({
      name: 'workshop_manage',
      for: ['organizer'],
      actions: ['workshop.publish'],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-workshop-review' }],
    });
    const to = screenSpec({
      name: 'workshop_review',
      for: ['organizer'],
      subject: 'workshop',
      precondition: 'state == draft', // published(遷移後)を排他的に弾く
      onFail: 'workshop_manage',
    });

    const findings = transitionLandingVerifier.verify(
      screenInput({ domain: domain(), screens: [from, to] }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S15');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('precondition');
    expect(findings[0]?.counterexample).toMatchObject({
      screen: 'workshop_manage',
      to: 'workshop_review',
      state: 'published',
    });
  });

  it('by のロールが行き先画面に入れなければ失敗する', () => {
    const from = screenSpec({
      name: 'workshop_manage',
      for: ['organizer'],
      actions: ['workshop.publish'],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-member-home' }],
    });
    const to = screenSpec({ name: 'member_home', for: ['member'] });

    const findings = transitionLandingVerifier.verify(
      screenInput({
        domain: specModel({
          roles: [role('anonymous'), role('member'), role('organizer'), role('system')], // organizer が member を含意しない
          aggregates: [...domain().aggregates.values()],
        }),
        screens: [from, to],
      }),
      SCREEN_CTX,
    );

    expect(findings.some((f) => f.message.includes('入れません'))).toBe(true);
    expect(findings[0]?.verifier).toBe('S15');
  });

  it('この画面の for と交差しない by ロールは対象にしない(実測: membership.suspend の account_owner)', () => {
    // by: [account_owner, staff] だが、account_owner の経路はこの画面には無い(別画面の話)。
    // for: [staff] と交差しないロールまで着地判定に混ぜると、staff だけが使う画面のはずの
    // navigations が account_owner 側の理由で誤ってエラーになる(実測: member_admin)。
    const withMixedByRoles = specModel({
      roles: [role('anonymous'), role('member'), role('staff'), role('account_owner', 'member.id == actor.id', ['member']), role('system')],
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('state', { kind: 'state', machine: 'workshop' })]),
          stateMachines: [
            machine({
              machine: 'workshop',
              states: ['draft', 'published'],
              events: [
                event({ id: 'publish', from: ['draft'], to: 'published', by: ['account_owner', 'staff'] }),
              ],
            }),
          ],
        }),
      ],
    });
    const from = screenSpec({
      name: 'workshop_admin',
      for: ['staff'],
      actions: ['workshop.publish'],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-workshop-admin' }],
    });

    const findings = transitionLandingVerifier.verify(
      screenInput({ domain: withMixedByRoles, screens: [from] }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('success でない navigations は対象にしない', () => {
    const from = screenSpec({
      name: 'workshop_manage',
      for: ['organizer'],
      navigations: [{ on: 'back', to: 'screen-nowhere' }],
    });

    const findings = transitionLandingVerifier.verify(screenInput({ domain: domain(), screens: [from] }), SCREEN_CTX);
    expect(findings).toEqual([]);
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    const findings = transitionLandingVerifier.verify(
      screenInput({ domain: domain(), screensUnavailable: true }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('関門(auth)が阻害なら「入れるロール」の判定だけを出さない(遷移後の状態を弾くかは関門に依らないので、出し続ける)', () => {
    const authGap = { ...SCREEN_CTX, reachabilityGaps: [{ input: 'auth', state: 'blocked', reason: 'load-failed' }] } as const;
    const from = screenSpec({
      name: 'workshop_manage',
      for: ['organizer'],
      actions: ['workshop.publish'],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-member-home' }, { on: 'workshop.publish.success', to: 'screen-workshop-review' }],
    });
    const toMember = screenSpec({ name: 'member_home', for: ['member'] });
    const toReview = screenSpec({ name: 'workshop_review', for: ['organizer'], subject: 'workshop', precondition: 'state == draft', onFail: 'workshop_manage' });
    const noImply = specModel({
      roles: [role('anonymous'), role('member'), role('organizer'), role('system')], // organizer が member を含意しない
      aggregates: [...domain().aggregates.values()],
    });
    const input = screenInput({ domain: noImply, screens: [from, toMember, toReview] });

    const open = transitionLandingVerifier.verify(input, SCREEN_CTX);
    const withheld = transitionLandingVerifier.verify(input, authGap);

    expect(open.some((f) => f.message.includes('入れません'))).toBe(true);
    expect(withheld.some((f) => f.message.includes('入れません'))).toBe(false);
    expect(withheld.some((f) => f.message.includes('precondition'))).toBe(true);
  });
});
