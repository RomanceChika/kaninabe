/**
 * world の行の組み立て(`lib/world/rls-world-rows.ts`)のうち、**一意の鍵になっている参照の列**の扱い。
 *
 * 1 系統は集約ごとに 1 行を共有するが、参照の列が単独で一意の鍵(`formal.type: uniqueness`・鍵がその列だけ・`where` なし)なら、
 * 参照する行ごとに別の行を指さなければならない。1 行に畳むと、実行者自身の行と的として分けた別人の行が同じ参照先を指して一意制約に当たり、
 * world が 1 行も入らない(「1 つの招待から生まれるメンバーは 1 人まで」= メンバーの招待の列を一意にした日に、生成テスト 28 本が落ちた)。
 */

import { describe, expect, it } from 'vitest';
import { buildBranch } from '../../../lib/world/rls-world-rows.js';
import { uniqueRefColumnsOf } from '../../../lib/world/rls-world-unique.js';
import type { BranchInput } from '../../../lib/world/rls-world-rows.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, field, invariant, invariantSpec, specModel } from '../../helpers/model-builder-v8plus.js';

/** メンバー(実行者の集約)が招待(発行者の参照でメンバーに戻る循環)を 1 本指す題材。`formals` はメンバーの不変条件。 */
function model(...formals: readonly InvariantFormal[]): SpecModel {
  return specModel({
    aggregates: [
      aggregate({
        name: 'member',
        entity: entitySpec('member', [
          field('name', { kind: 'string' }, { required: true }),
          field('invited_via', { kind: 'ref', entity: 'invitation' }, { required: true }),
        ]),
        access: accessSpec('member', {}),
        ...(formals.length === 0
          ? {}
          : {
              invariants: invariantSpec(
                formals.map((formal, index) => invariant({ id: `INV-MEMBER-00${index + 1}`, entities: ['member'], formal })),
              ),
            }),
      }),
      aggregate({
        name: 'invitation',
        entity: entitySpec('invitation', [field('issued_by', { kind: 'ref', entity: 'member' }, { required: true })]),
        access: accessSpec('invitation', {}),
      }),
    ],
  });
}

/** 組み立ての入力(表は集約名の複数形・既定値なし・束縛なし)。 */
function input(domain: SpecModel): BranchInput {
  let counter = 0;
  return {
    domain,
    tableOf: (entity) => `${entity}s`,
    defaultsOf: () => ({}),
    actorEntity: 'member',
    requiredFields: () => [],
    boundColumns: () => [],
    ownBinding: null,
    next: () => (counter += 1),
  };
}

/** 実行者と、的として分けた別人(同じ集約)のメンバーの行が指す招待の名前。 */
function invitationsOfMembers(domain: SpecModel): { readonly actor: string | undefined; readonly target: string | undefined } {
  const built = buildBranch(input(domain), 'a', 'member', { separateTarget: true });
  if (!built.ok) throw new Error(`組み立てられません: ${built.unreachable.join(', ')}`);
  const members = built.branch.rows.filter((row) => row.entity === 'member');
  expect(members).toHaveLength(2);
  return { actor: members[0]?.refs['invited_via'], target: members[1]?.refs['invited_via'] };
}

describe('uniqueRefColumnsOf', () => {
  it('鍵がその 1 列だけで where の無い uniqueness の列だけを返す', () => {
    expect(uniqueRefColumnsOf(model({ kind: 'uniqueness', keys: ['invited_via'] }), 'member')).toEqual(new Set(['invited_via']));
    // 複合の鍵・限定条件つきの一意・一意でない不変条件は返さない。
    expect(uniqueRefColumnsOf(model({ kind: 'uniqueness', keys: ['invited_via', 'name'] }), 'member')).toEqual(new Set());
    expect(uniqueRefColumnsOf(model({ kind: 'uniqueness', keys: ['invited_via'], where: 'member.name == x' }), 'member')).toEqual(new Set());
    expect(uniqueRefColumnsOf(model({ kind: 'check', expr: 'member.name != x' }), 'member')).toEqual(new Set());
    // 別の集約の不変条件は数えない。
    expect(uniqueRefColumnsOf(model({ kind: 'uniqueness', keys: ['invited_via'] }), 'invitation')).toEqual(new Set());
  });
});

describe('一意の鍵になっている参照の列の world', () => {
  it('一意でない参照は集約ごとの 1 行を共有する(従来どおり)', () => {
    const { actor, target } = invitationsOfMembers(model());

    expect(actor).toBeDefined();
    expect(target).toBe(actor);
  });

  it('一意の鍵の参照は、参照する行ごとに別の行を指す(実行者の行と的の行が同じ招待に当たらない)', () => {
    const { actor, target } = invitationsOfMembers(model({ kind: 'uniqueness', keys: ['invited_via'] }));

    expect(actor).toBeDefined();
    expect(target).toBeDefined();
    expect(target).not.toBe(actor);
  });

  it('別の行を指しても、招待の発行者はメンバーの 1 行(循環の辺は同じメンバーを指す)で、行の名前は重ならない', () => {
    const built = buildBranch(input(model({ kind: 'uniqueness', keys: ['invited_via'] })), 'a', 'member', { separateTarget: true });
    if (!built.ok) throw new Error('組み立てられません');
    const keys = built.branch.rows.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
    const invitations = built.branch.rows.filter((row) => row.entity === 'invitation');
    expect(invitations).toHaveLength(2);
    for (const row of invitations) expect(row.refs['issued_by']).toBe(built.branch.byEntity.get('member'));
  });
});
