/**
 * 編集規則エンジン（canWrite）のユニットテスト。
 *
 * 仕様: docs/specs/domain/program/access.md（writes）
 *       docs/specs/domain/entry/access.md（writes）
 *       docs/rules/process/common/specification/standards/domain-spec-writing.md（deny by default）
 *
 * 表はテスト内で手書きする（エンジンは表を持たず、渡された表を解釈するだけの純粋関数である）。
 */

import { describe, expect, it } from 'vitest';
import { canWrite } from '@kaninabe/runtime/engine';
import type { GuardExprData, WriteTable } from '@kaninabe/runtime/engine';

/** `state == draft` の AST。 */
const DRAFT: GuardExprData = {
  kind: 'compare',
  path: 'state',
  op: '==',
  rhs: { kind: 'literal', value: 'draft' },
};

/**
 * borrower は下書きのとき title / note を、提出後は note だけを編集でき、
 * system は無条件に note を編集できる表。
 */
const table = {
  entity: 'entry',
  rules: [
    { by: 'borrower', fields: ['title', 'note'], guard: DRAFT, guardSource: 'state == draft' },
    { by: 'system', fields: ['note'] },
  ],
} as const satisfies WriteTable;

describe('canWrite', () => {
  it('ロール・フィールドが一致しガードも成立すれば許可する', () => {
    const decision = canWrite(table, {
      field: 'title',
      actorRoles: ['member', 'borrower'],
      env: { state: 'draft' },
    });

    expect(decision).toEqual({ allowed: true, by: 'borrower' });
  });

  it('ガードが無い規則は無条件に許可する', () => {
    const decision = canWrite(table, { field: 'note', actorRoles: ['system'], env: {} });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-TABLE-004
  it('表に無いロールは編集できない（deny by default）', () => {
    const decision = canWrite(table, { field: 'title', actorRoles: ['member'], env: { state: 'draft' } });

    expect(decision).toEqual({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: ['borrower'],
      actorRoles: ['member'],
    });
  });

  it('ロールは一致してもそのフィールドを許す規則が無ければ拒否する', () => {
    const decision = canWrite(table, {
      field: 'duration_min',
      actorRoles: ['borrower'],
      env: { state: 'draft' },
    });

    // そのフィールドを編集してよいロールは 1 つも無いので候補は空になる。
    expect(decision).toEqual({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: [],
      actorRoles: ['borrower'],
    });
  });

  it('ガードが偽なら guard_unsatisfied として拒否し、原文を診断に載せる', () => {
    const decision = canWrite(table, {
      field: 'title',
      actorRoles: ['borrower'],
      env: { state: 'submitted' },
    });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unsatisfied',
      guardSource: 'state == draft',
    });
  });

  it('評価に必要な値が env に無ければ guard_unknown として拒否する（偽に潰さない）', () => {
    const decision = canWrite(table, {
      field: 'title',
      actorRoles: ['borrower'],
      env: { state: null },
    });

    expect(decision).toEqual({
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'state == draft',
      unresolvedPaths: ['state'],
    });
  });

  it('境界: 同じフィールドに複数の規則が当たる場合はどれか1本でも成立すれば許可する', () => {
    const decision = canWrite(table, {
      field: 'note',
      actorRoles: ['borrower', 'system'],
      env: { state: 'submitted' },
    });

    expect(decision).toEqual({ allowed: true, by: 'system' });
  });

  it('境界: 規則が 1 本も無い表では誰も編集できない', () => {
    const empty = { entity: 'program_item', rules: [] } as const satisfies WriteTable;

    expect(canWrite(empty, { field: 'order_index', actorRoles: ['librarian'], env: {} })).toMatchObject({
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: [],
    });
  });

  it('境界: 評価不能と不成立が混在する場合は評価不能を優先して診断する', () => {
    const mixed = {
      entity: 'entry',
      rules: [
        { by: 'borrower', fields: ['note'], guard: DRAFT, guardSource: 'state == draft' },
        {
          by: 'borrower',
          fields: ['note'],
          guard: {
            kind: 'compare',
            path: 'item.state',
            op: '==',
            rhs: { kind: 'literal', value: 'accepting' },
          },
          guardSource: 'item.state == accepting',
        },
      ],
    } as const satisfies WriteTable;

    const decision = canWrite(mixed, {
      field: 'note',
      actorRoles: ['borrower'],
      env: { state: 'submitted' },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'item.state == accepting',
    });
  });

  it('境界: 副作用を宣言した規則が通ると、許可に effects が載る', () => {
    // 束 ①-b でパッケージがカバレッジの閾値を自分で持つようにしたとき、この分岐だけが
    // **自分のテストでは通っていなかった**（それまでは製品側の別のテストが偶然踏んでいた）。
    // `effects` は編集の副作用の宣言（access_spec の `writes[].effects`）で、実行器は許可を
    // 返した規則が宣言していたものだけを集める。
    const withEffects = {
      entity: 'entry',
      rules: [{ by: 'borrower', fields: ['note'], effects: ['entry_note_changed'] }],
    } as const satisfies WriteTable;

    const decision = canWrite(withEffects, {
      field: 'note',
      actorRoles: ['borrower'],
      env: {},
    });

    expect(decision).toEqual({ allowed: true, by: 'borrower', effects: ['entry_note_changed'] });
  });
});
