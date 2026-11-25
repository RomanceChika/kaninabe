/**
 * 作成規則エンジン（canCreate）のユニットテスト。
 *
 * 仕様: docs/specs/domain/entry/access.md（creates）
 *       docs/rules/process/common/specification/standards/domain-spec-writing.md（deny by default）
 *
 * 表はテスト内で手書きする（エンジンは表を持たず、渡された表を解釈するだけの純粋関数である）。
 */

import { describe, expect, it } from 'vitest';
import { canCreate } from '@kaninabe/runtime/engine';
import type { CreateTable, GuardExprData } from '@kaninabe/runtime/engine';

/** `workshop.state == accepting` の AST（生成物と同じ形）。 */
/** 作成の縛りの節で使うガード(題材の語を使わない中立の例)。 */
const AVAILABLE: GuardExprData = {
  kind: 'compare',
  path: 'item.state',
  op: '==',
  rhs: { kind: 'literal', value: 'available' },
};

const ACCEPTING: GuardExprData = {
  kind: 'compare',
  path: 'workshop.state',
  op: '==',
  rhs: { kind: 'literal', value: 'accepting' },
};

/** member は受付中のときだけ作れ、system は無条件に作れる表。 */
const table = {
  entity: 'entry',
  rules: [
    { by: 'member', guard: ACCEPTING, guardSource: 'workshop.state == accepting' },
    { by: 'system' },
  ],
} as const satisfies CreateTable;

describe('canCreate', () => {
  it('ロールが一致しガードも成立すれば許可する', () => {
    const decision = canCreate(table, {
      actorRoles: ['member'],
      env: { 'workshop.state': 'accepting' },
    });

    expect(decision).toEqual({ allowed: true, by: 'member' });
  });

  it('ガードが無い規則は無条件に許可する', () => {
    const decision = canCreate(table, { actorRoles: ['system'], env: {} });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-TABLE-002
  it('表に無いロールは作成できない（deny by default）', () => {
    const decision = canCreate(table, {
      actorRoles: ['anonymous'],
      env: { 'workshop.state': 'accepting' },
    });

    expect(decision).toEqual({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: ['member', 'system'],
      actorRoles: ['anonymous'],
    });
  });

  it('ガードが偽なら guard_unsatisfied として拒否し、原文を診断に載せる', () => {
    const decision = canCreate(table, {
      actorRoles: ['member'],
      env: { 'workshop.state': 'closed' },
    });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unsatisfied',
      guardSource: 'workshop.state == accepting',
    });
  });

  it('評価に必要な値が env に無ければ guard_unknown として拒否する（偽に潰さない）', () => {
    const decision = canCreate(table, { actorRoles: ['member'], env: { 'workshop.state': null } });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'workshop.state == accepting',
      unresolvedPaths: ['workshop.state'],
    });
  });

  it('境界: 実行者が複数ロールを持つ場合はどれか1本でも成立すれば許可する', () => {
    const decision = canCreate(table, {
      actorRoles: ['member', 'system'],
      env: { 'workshop.state': 'closed' },
    });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  it('境界: 規則が 1 本も無い表では誰も作れない', () => {
    const empty = { entity: 'program', rules: [] } as const satisfies CreateTable;

    expect(canCreate(empty, { actorRoles: ['member'], env: {} })).toMatchObject({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: [],
    });
  });

  it('境界: 評価不能と不成立が混在する場合は評価不能を優先して診断する', () => {
    const mixed = {
      entity: 'entry',
      rules: [
        { by: 'member', guard: ACCEPTING, guardSource: 'workshop.state == accepting' },
        {
          by: 'member',
          guard: {
            kind: 'compare',
            path: 'workshop.kind',
            op: '==',
            rhs: { kind: 'literal', value: 'solo' },
          },
          guardSource: 'workshop.kind == solo',
        },
      ],
    } as const satisfies CreateTable;

    const decision = canCreate(mixed, { actorRoles: ['member'], env: { 'workshop.state': 'closed' } });

    expect(decision).toMatchObject({ allowed: false, reason: 'guard_unknown', guardSource: 'workshop.kind == solo' });
  });
});

/**
 * 規則の縛り(`self`)。作成で行に入る実行者の参照の欄が実行者そのものでなければ、その規則は当てはまらない
 * (`by` の段。legacy/spec-tools/lib/usecase/actor-bound.ts が導く)。
 */
describe('canCreate の規則の縛り(self)', () => {
  /** 利用者は自分の名義でだけ、受付中に作れる。司書(縛り無し)は誰の名義でも、受付中に作れる。 */
  const bound = {
    entity: 'loan',
    rules: [
      { by: 'patron', guard: AVAILABLE, guardSource: 'item.state == available', self: ['loan.patron_id'] },
      { by: 'librarian', guard: AVAILABLE, guardSource: 'item.state == available' },
    ],
  } as const satisfies CreateTable;

  it('縛られた欄が実行者そのものなら、規則が当てはまる', () => {
    const decision = canCreate(bound, {
      actorRoles: ['patron'],
      env: { 'item.state': 'available', 'actor.id': 'p1', 'loan.patron_id': 'p1' },
    });

    expect(decision).toEqual({ allowed: true, by: 'patron' });
  });

  it('縛られた欄が他人なら role_forbidden(ガードより前に落ちる)', () => {
    const decision = canCreate(bound, {
      actorRoles: ['patron'],
      env: { 'item.state': 'on_loan', 'actor.id': 'p1', 'loan.patron_id': 'p2' },
    });

    expect(decision).toMatchObject({ allowed: false, reason: 'role_forbidden' });
  });

  it('縛りが成り立てば、ガードの段は従来どおり guard_unsatisfied', () => {
    const decision = canCreate(bound, {
      actorRoles: ['patron'],
      env: { 'item.state': 'on_loan', 'actor.id': 'p1', 'loan.patron_id': 'p1' },
    });

    expect(decision).toMatchObject({ allowed: false, reason: 'guard_unsatisfied' });
  });

  it('縛りの無い規則(司書)は他人の名義でも当てはまり、ガードだけで判定する', () => {
    expect(
      canCreate(bound, { actorRoles: ['librarian'], env: { 'item.state': 'available', 'actor.id': 'l1', 'loan.patron_id': 'p2' } }),
    ).toEqual({ allowed: true, by: 'librarian' });
    expect(
      canCreate(bound, { actorRoles: ['librarian'], env: { 'item.state': 'on_loan', 'actor.id': 'l1', 'loan.patron_id': 'p2' } }),
    ).toMatchObject({ allowed: false, reason: 'guard_unsatisfied' });
  });

  it('実行者の id が無い・空・欄の値が無いなら成り立たない(不明を許可に倒さない)', () => {
    for (const env of [
      { 'item.state': 'available', 'loan.patron_id': 'p1' },
      { 'item.state': 'available', 'actor.id': '', 'loan.patron_id': '' },
      { 'item.state': 'available', 'actor.id': 'p1' },
      { 'item.state': 'available', 'actor.id': 'p1', 'loan.patron_id': null },
    ]) {
      expect(canCreate(bound, { actorRoles: ['patron'], env })).toMatchObject({ allowed: false, reason: 'role_forbidden' });
    }
  });
});
