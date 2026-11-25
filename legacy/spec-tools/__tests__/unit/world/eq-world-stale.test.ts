/**
 * 古いロール一覧(`from_stale`。ADR-0018)の中身 —— 条件を満たしていた頃に解決された配列は、
 * **既定のログインロール + その人の claim のロールを `implies` で閉じたもの**であること(特定の製品に依らない)。
 */

import { describe, expect, it } from 'vitest';
import { actorsOf, staleRolesOf } from '../../../lib/world/eq-world-actors.js';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';

const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active'],
};
/** 多段の含意: top → mid → member。mid と top はどちらも claim のロール(別の欄)。 */
const mid: RoleDef = { ...role('mid', undefined, ['member']), claim: 'member.is_mid' };
const top: RoleDef = { ...role('top', undefined, ['mid']), claim: 'member.is_top' };
const lone: RoleDef = { ...role('lone', undefined, ['member']), claim: 'member.is_lone' };

function domain(): SpecModel {
  return specModel(
    [
      aggregate('member', {
        entity: entitySpec('member', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('is_mid', { kind: 'boolean' }, { session: true }),
            field('is_top', { kind: 'boolean' }, { session: true }),
            field('is_lone', { kind: 'boolean' }, { session: true }),
            field('state', { kind: 'state', machine: 'member' }, { session: true }),
          ],
        }),
        stateMachines: [machine('member', { states: ['guest', 'active', 'left'], initial: 'guest' })],
      }),
    ],
    roleSpec([role('anonymous', undefined, undefined, 'anonymous'), member, mid, top, lone, role('system', undefined, undefined, 'system')]),
  );
}

describe('staleRolesOf', () => {
  it('claim のロールが無ければ既定のログインロールだけ', () => {
    expect(staleRolesOf(domain(), [])).toEqual(['member']);
  });

  it('claim のロールは既定のログインロールと並ぶ(含意の先は閉包で足される)', () => {
    expect(staleRolesOf(domain(), ['lone'])).toEqual(['member', 'lone']);
  });

  it('多段の含意でも閉じる(top → mid → member の全部が入る)・複数の claim のロールも全部入る', () => {
    expect([...staleRolesOf(domain(), ['top'])].sort()).toEqual(['member', 'mid', 'top']);
    expect([...staleRolesOf(domain(), ['top', 'lone'])].sort()).toEqual(['lone', 'member', 'mid', 'top']);
  });

  it('既定のログインロールが無い仕様では claim のロールだけ(throw しない)', () => {
    const free: RoleDef = { ...role('free'), claim: 'member.is_lone' };
    const none = specModel([], roleSpec([role('anonymous', undefined, undefined, 'anonymous'), free]));
    expect(staleRolesOf(none, ['free'])).toEqual(['free']);
  });
});

describe('actorsOf — 条件を満たさない人の古いロール一覧', () => {
  it('claim の人は自分のロールを含む古い一覧・束縛の人とログインの人はログインロールだけ。実行器が解決する配列は未ログイン側', () => {
    const actors = actorsOf(
      { domain: domain(), tables: [], bindingRoles: new Map([['owner', 'project.owner_id']]), claimRoles: ['top'] },
      'project',
    );
    const stale = (key: string): readonly string[] | undefined =>
      actors.find((actor) => actor.key === key)?.arrays.find((array) => array.name === 'from_stale')?.roles;
    expect([...(stale('top_unmet_member') ?? [])].sort()).toEqual(['member', 'mid', 'top']);
    expect(stale('member_unmet_member')).toEqual(['member']);
    const honest = actors.find((actor) => actor.key === 'top_unmet_member')?.arrays.find((array) => array.name === 'from_session');
    expect(honest?.roles).toEqual(['anonymous']);
    // 通常の実行者は古い一覧を持たない。
    expect(actors.find((actor) => actor.key === 'top')?.arrays.map((array) => array.name)).toEqual(['from_session', 'from_runtime', 'empty']);
  });
});
