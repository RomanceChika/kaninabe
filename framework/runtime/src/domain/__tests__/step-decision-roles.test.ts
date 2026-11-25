/**
 * 実行者自身の行の条件(`claim`。ADR-0018)の読み方のテスト。
 *
 *   - `rowConditionHolds`: boolean の欄は真・state / enum の欄は値の集合のどれか。欄が無い・型が合わないは満たさない
 *   - `arrayActorRoles`: 配列から来たロールにも、`claim` / `binding` で立つロールにも、手順が運ぶ行の条件
 *     (`roleGates`)が効く。条件を持たない手順は従来と同じ
 */

import { describe, expect, it } from 'vitest';
import type { RunStepPlan } from '@kaninabe/runtime/plan';
import { arrayActorRoles, rowConditionHolds } from '../step-decision';

describe('rowConditionHolds', () => {
  it('boolean の欄(values が無い)は真のときだけ満たす', () => {
    expect(rowConditionHolds({ field: 'is_ok' }, { is_ok: true })).toBe(true);
    expect(rowConditionHolds({ field: 'is_ok' }, { is_ok: false })).toBe(false);
    expect(rowConditionHolds({ field: 'is_ok' }, { is_ok: 'true' })).toBe(false);
    expect(rowConditionHolds({ field: 'is_ok' }, {})).toBe(false);
  });

  it('state / enum の欄は値の集合のどれかのときだけ満たす', () => {
    const condition = { field: 'state', values: ['active', 'trial'] };
    expect(rowConditionHolds(condition, { state: 'active' })).toBe(true);
    expect(rowConditionHolds(condition, { state: 'trial' })).toBe(true);
    expect(rowConditionHolds(condition, { state: 'left' })).toBe(false);
    expect(rowConditionHolds(condition, { state: true })).toBe(false);
    expect(rowConditionHolds(condition, { state: null })).toBe(false);
    expect(rowConditionHolds(condition, {})).toBe(false);
  });

  it('行が自前のプロパティとして持たない欄(継承されたもの)は読まない', () => {
    expect(rowConditionHolds({ field: 'toString', values: ['x'] }, {})).toBe(false);
    expect(rowConditionHolds({ field: 'constructor' }, {})).toBe(false);
  });
});

/** 何も立たない手順(規則表は引かない)。 */
const BASE: RunStepPlan = {
  op: 'widget.update',
  alias: 'widget.update',
  label: '更新',
  kind: 'update',
  aggregate: 'widget',
  repeat: false,
  self: false,
  event: null,
  createRules: null,
  deleteRules: null,
  writeRules: null,
  machine: null,
  stateFrom: null,
  guardFacts: [],
  roleFacts: [{ role: 'owner', source: { kind: 'external', ref: 'widget.owner_id' } }],
  claimFacts: [
    { role: 'staff', field: 'is_staff' },
    { role: 'paused', field: 'state', values: ['suspended', 'lapsed'] },
  ],
  unresolvableRoles: [],
  inputKeys: [],
};

const ACTOR = 'a1';
const ownedBy =
  (owner: string) =>
  (source: { readonly kind: string }): unknown =>
    source.kind === 'external' ? owner : null;

describe('arrayActorRoles — 値の集合の claim', () => {
  it('値の集合に入る欄を持つ実行者に claim のロールが立つ(入らなければ立たない)', () => {
    expect(arrayActorRoles(BASE, [], ACTOR, { state: 'lapsed' }, ownedBy('x'))).toEqual(['paused']);
    expect(arrayActorRoles(BASE, [], ACTOR, { state: 'active' }, ownedBy('x'))).toEqual([]);
    expect(arrayActorRoles(BASE, [], ACTOR, {}, ownedBy('x'))).toEqual([]);
  });
});

describe('arrayActorRoles — 含意の先の行の条件(roleGates)', () => {
  const GATED: RunStepPlan = {
    ...BASE,
    roleGates: {
      member: [{ field: 'state', values: ['active'] }],
      owner: [{ field: 'state', values: ['active'] }],
      staff: [{ field: 'state', values: ['active'] }],
    },
  };

  it('条件を満たす実行者は、配列・claim・binding のどれから来たロールも残る', () => {
    const row = { state: 'active', is_staff: true };
    expect(arrayActorRoles(GATED, ['member'], ACTOR, row, ownedBy(ACTOR))).toEqual(['member', 'staff', 'owner']);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-002
  it('条件を満たさない実行者は、配列から来たロールも claim・binding で立つロールも落ちる', () => {
    const row = { state: 'left', is_staff: true };
    expect(arrayActorRoles(GATED, ['member'], ACTOR, row, ownedBy(ACTOR))).toEqual([]);
  });

  it('条件を持たないロール(キーに無い)は落ちない', () => {
    const row = { state: 'suspended' };
    expect(arrayActorRoles(GATED, ['other'], ACTOR, row, ownedBy('x'))).toEqual(['other', 'paused']);
  });

  it('行が無い実行者(行が空)は、条件を持つロールが落ちる', () => {
    expect(arrayActorRoles(GATED, ['member'], ACTOR, {}, ownedBy(ACTOR))).toEqual([]);
  });

  it('roleGates を運ばない手順は従来と同じ(条件を宣言しない製品)', () => {
    expect(arrayActorRoles(BASE, ['member'], ACTOR, { is_staff: true }, ownedBy(ACTOR))).toEqual([
      'member',
      'staff',
      'owner',
    ]);
  });
});

describe('arrayActorRoles — 行から立つロールは配列に入っていても行で決める', () => {
  it('claim のロールが配列に入っていても、行の条件を満たさなければ立たない', () => {
    expect(arrayActorRoles(BASE, ['staff', 'paused'], ACTOR, { is_staff: false, state: 'active' }, ownedBy('x'))).toEqual([]);
    expect(arrayActorRoles(BASE, ['staff'], ACTOR, {}, ownedBy('x'))).toEqual([]);
  });

  it('束縛のロールが配列に入っていても、束縛が成り立たなければ立たない', () => {
    expect(arrayActorRoles(BASE, ['owner'], ACTOR, {}, ownedBy('other'))).toEqual([]);
  });

  it('行の条件・束縛が成り立てば、配列にあってもなくても立つ(重複しない)', () => {
    expect(arrayActorRoles(BASE, ['staff', 'owner'], ACTOR, { is_staff: true }, ownedBy(ACTOR))).toEqual(['staff', 'owner']);
  });
});
