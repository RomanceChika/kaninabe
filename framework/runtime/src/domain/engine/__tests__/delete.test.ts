/**
 * 削除規則エンジン（canDelete）のユニットテスト。
 *
 * 仕様: docs/specs/domain/entry/access.md（deletes）
 *       docs/specs/domain/program/access.md（deletes）
 *       docs/rules/process/common/specification/standards/domain-spec-writing.md（deny by default）
 *
 * 表はテスト内で手書きする（エンジンは表を持たず、渡された表を解釈するだけの純粋関数である）。
 */

import { describe, expect, it } from 'vitest';
import { canDelete } from '@kaninabe/runtime/engine';
import type { DeleteTable, GuardExprData } from '@kaninabe/runtime/engine';

/** `state == draft` の AST（生成物と同じ形。削除は対象自身の状態を参照できる）。 */
const DRAFT: GuardExprData = {
  kind: 'compare',
  path: 'state',
  op: '==',
  rhs: { kind: 'literal', value: 'draft' },
};

/** borrower は下書きのときだけ消せ、system は無条件に消せる表。 */
const table = {
  entity: 'entry',
  rules: [
    { by: 'borrower', guard: DRAFT, guardSource: 'state == draft' },
    { by: 'system' },
  ],
} as const satisfies DeleteTable;

describe('canDelete', () => {
  it('ロールが一致しガードも成立すれば許可する', () => {
    const decision = canDelete(table, { actorRoles: ['member', 'borrower'], env: { state: 'draft' } });

    expect(decision).toEqual({ allowed: true, by: 'borrower' });
  });

  it('ガードが無い規則は無条件に許可する', () => {
    const decision = canDelete(table, { actorRoles: ['system'], env: {} });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-TABLE-003
  it('表に無いロールは削除できない（deny by default）', () => {
    const decision = canDelete(table, { actorRoles: ['member'], env: { state: 'draft' } });

    expect(decision).toEqual({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: ['borrower', 'system'],
      actorRoles: ['member'],
    });
  });

  it('ガードが偽なら guard_unsatisfied として拒否し、原文を診断に載せる', () => {
    const decision = canDelete(table, { actorRoles: ['borrower'], env: { state: 'submitted' } });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unsatisfied',
      guardSource: 'state == draft',
    });
  });

  it('評価に必要な値が env に無ければ guard_unknown として拒否する（偽に潰さない）', () => {
    const decision = canDelete(table, { actorRoles: ['borrower'], env: { state: null } });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'state == draft',
      unresolvedPaths: ['state'],
    });
  });

  it('境界: 実行者が複数ロールを持つ場合はどれか1本でも成立すれば許可する', () => {
    const decision = canDelete(table, {
      actorRoles: ['borrower', 'system'],
      env: { state: 'submitted' },
    });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  it('境界: 規則が 1 本も無い表では誰も消せない', () => {
    const empty = { entity: 'item', rules: [] } as const satisfies DeleteTable;

    expect(canDelete(empty, { actorRoles: ['librarian'], env: {} })).toMatchObject({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: [],
    });
  });

  it('境界: 評価不能と不成立が混在する場合は評価不能を優先して診断する', () => {
    const mixed = {
      entity: 'entry',
      rules: [
        { by: 'borrower', guard: DRAFT, guardSource: 'state == draft' },
        {
          by: 'borrower',
          guard: {
            kind: 'compare',
            path: 'item.state',
            op: '==',
            rhs: { kind: 'literal', value: 'closed' },
          },
          guardSource: 'item.state == closed',
        },
      ],
    } as const satisfies DeleteTable;

    const decision = canDelete(mixed, { actorRoles: ['borrower'], env: { state: 'submitted' } });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'item.state == closed',
    });
  });
});
