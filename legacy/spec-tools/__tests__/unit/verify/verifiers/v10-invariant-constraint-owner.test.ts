/**
 * V10 の 1 項「DB の執行点の名前から不変条件が 1 つに決まる」の規約網羅テスト。
 *
 * 対象の要求: domain-spec-writing.md V10 / ARCH-SP-BE-0001 §テーブル仕様 —— 制約名・トリガ
 * 関数名から不変条件が 1 つに決まること(例外の本文から名前を拾って `invariant_violated` に
 * 写す形なので、1 名前 = 1 不変条件である)。直す前はこの前提を生成器が例外で守っていた。
 */

import { describe, expect, it } from 'vitest';
import { constraintOwners } from '../../../../lib/semantics/constraint-owners.js';
import { ownerConflictOf } from '../../../../lib/messages/messages-owner-conflict.js';
import { checkConstraintOwners } from '../../../../lib/verify/verifiers/v10-invariant-constraint-owner.js';
import type { EnforcementDef } from '../../../../lib/model/types.js';
import {
  aggregate,
  entitySpec,
  field,
  invariant,
  invariantSpec,
  loc,
  specModel,
} from '../../../helpers/model-builder-v8plus.js';

/** 執行点宣言のショートハンド。 */
function enforcement(kind: EnforcementDef['kind'], ref: string): EnforcementDef {
  return { kind, ref, location: loc() };
}

/** 不変条件 2 本(それぞれの執行点を渡す)を持つ shelf 集約 1 つのモデル。 */
function model(first: readonly EnforcementDef[], second: readonly EnforcementDef[]) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'shelf',
        entity: entitySpec('shelf', [
          field('store_id', { kind: 'ref', entity: 'store' }),
          field('company_id', { kind: 'ref', entity: 'company' }),
        ]),
        invariants: invariantSpec([
          invariant({ id: 'INV-SHELF-002', enforcedBy: first }),
          invariant({ id: 'INV-SHELF-003', enforcedBy: second }),
        ]),
      }),
      aggregate({ name: 'store', entity: entitySpec('store', [field('name', { kind: 'string' })]) }),
      aggregate({ name: 'company', entity: entitySpec('company', [field('name', { kind: 'string' })]) }),
    ],
  });
}

describe('V10 執行点の名前から不変条件が 1 つに決まる', () => {
  it('執行点が不変条件ごとに分かれていれば通る', () => {
    const target = model([enforcement('trigger', 'sync_shelf_company')], [enforcement('trigger', 'sync_shelf_store')]);

    expect(checkConstraintOwners(target)).toEqual([]);
  });

  it('同じトリガ名を 2 つの不変条件が宣言するとエラーになる', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_placement')],
      [enforcement('trigger', 'sync_shelf_placement')],
    );

    const findings = checkConstraintOwners(target);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('sync_shelf_placement');
    expect(findings[0]?.counterexample).toMatchObject({
      ref: 'sync_shelf_placement',
      invariants: 'INV-SHELF-002 / INV-SHELF-003',
    });
  });

  it('同じ db_constraint 名でも同じようにエラーにする', () => {
    const target = model(
      [enforcement('db_constraint', 'shelves_placement_check')],
      [enforcement('db_constraint', 'shelves_placement_check')],
    );

    expect(checkConstraintOwners(target)).toHaveLength(1);
  });

  it('DB が執行しない kind(guard / application)は名前が重なっても見ない(境界)', () => {
    const target = model([enforcement('guard', 'shelf.place')], [enforcement('guard', 'shelf.place')]);

    expect(checkConstraintOwners(target)).toEqual([]);
  });

  it('同じ不変条件が同じ執行点を 2 度挙げても違反にしない(境界)', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_company'), enforcement('trigger', 'sync_shelf_company')],
      [enforcement('trigger', 'sync_shelf_store')],
    );

    expect(checkConstraintOwners(target)).toEqual([]);
  });
});

describe('constraintOwners(検査器と生成器が共有する 1 本の判定)', () => {
  it('DB 執行の宣言だけを「執行点の名前 → 不変条件」の表にする', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_company'), enforcement('guard', 'shelf.place')],
      [enforcement('db_constraint', 'shelves_store_unique')],
    );

    const { owner, clashes } = constraintOwners(target);

    expect([...owner]).toEqual([
      ['sync_shelf_company', 'INV-SHELF-002'],
      ['shelves_store_unique', 'INV-SHELF-003'],
    ]);
    expect(clashes).toEqual([]);
  });

  it('衝突は事実(名前・種別・先に宣言した側・後から宣言した不変条件)で返り、文面は ownerConflictOf が 1 か所で組む —— 検査器と生成器が同じ文面になる', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_placement')],
      [enforcement('trigger', 'sync_shelf_placement')],
    );

    const { clashes } = constraintOwners(target);
    const finding = checkConstraintOwners(target)[0];

    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ ref: 'sync_shelf_placement', kind: 'trigger', existing: 'INV-SHELF-002' });
    expect(clashes[0]?.invariant.id).toBe('INV-SHELF-003');
    const conflict = ownerConflictOf(clashes[0]!);
    // 検査器は同じ文面をそのまま Finding に写す(2 実装のドリフトが起きない形)。
    expect(finding?.message).toContain(conflict.message);
    expect(finding?.suggestion).toBe(conflict.suggestion);
    expect(finding?.counterexample).toEqual(conflict.counterexample);
  });

  it('衝突があっても表は組める(先に宣言した側が残る)', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_placement')],
      [enforcement('trigger', 'sync_shelf_placement')],
    );

    expect(constraintOwners(target).owner.get('sync_shelf_placement')).toBe('INV-SHELF-002');
  });
});
