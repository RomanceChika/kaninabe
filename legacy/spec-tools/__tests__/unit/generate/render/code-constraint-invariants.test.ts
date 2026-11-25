/**
 * 制約名 → 不変条件の表(code-constraint-invariants)の規約網羅テスト。
 *
 * 対象の要求: ARCH-SP-BE-0001 §テーブル仕様 / scripts-code-quality.md §生成器は throw しない。
 *   - `enforced_by` の DB 執行(db_constraint / trigger)だけを表にする
 *   - 表の組み立てと名前の一意性の判定は **V10 と共有の 1 本**(`constraintOwners`)が持ち、
 *     生成器はそれを字面にするだけである(束 ⑲-1: 判定が 2 実装だと、DB 執行の種別を片方に
 *     足したときに「verify は緑のまま generate が止まる」を作れてしまう)
 *   - 前提(1 名前 = 1 不変条件)が破れていたら V10 を示して止める
 */

import { describe, expect, it } from 'vitest';
import { constraintInvariantsGenerator } from '../../../../lib/generate/render/code-constraint-invariants.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
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

/** 不変条件 2 本(それぞれの執行点)を持つ shelf 集約のモデル。 */
function model(first: readonly EnforcementDef[], second: readonly EnforcementDef[]) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'shelf',
        entity: entitySpec('shelf', [field('name', { kind: 'string' })]),
        invariants: invariantSpec([
          invariant({ id: 'INV-SHELF-002', enforcedBy: first }),
          invariant({ id: 'INV-SHELF-003', enforcedBy: second }),
        ]),
      }),
    ],
  });
}

describe('code-constraint-invariants', () => {
  it('DB 執行の宣言を制約名順の 1 表にする', () => {
    const sections = constraintInvariantsGenerator.generate(
      model([enforcement('trigger', 'sync_shelf_company')], [enforcement('db_constraint', 'shelves_name_unique')]),
      GEN_CTX,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/constraint-invariants.ts');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = sections[0]?.content ?? '';
    expect(content).toContain("shelves_name_unique: 'INV-SHELF-003'");
    expect(content).toContain("sync_shelf_company: 'INV-SHELF-002'");
    // 制約名順(localeCompare)に並ぶ。
    expect(content.indexOf('shelves_name_unique')).toBeLessThan(content.indexOf('sync_shelf_company'));
  });

  it('DB が執行しない kind(guard / application)は表に入れない', () => {
    const sections = constraintInvariantsGenerator.generate(
      model([enforcement('guard', 'shelf.place')], [enforcement('application', 'place-shelf-action')]),
      GEN_CTX,
    );

    expect(sections).toEqual([]);
  });

  it('1 つの名前を 2 つの不変条件が宣言したら V10 を示して止める(スタックトレースにしない)', () => {
    const target = model(
      [enforcement('trigger', 'sync_shelf_placement')],
      [enforcement('trigger', 'sync_shelf_placement')],
    );

    let caught: unknown;
    try {
      constraintInvariantsGenerator.generate(target, GEN_CTX);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GeneratorPreconditionError);
    const findings = (caught as GeneratorPreconditionError).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V10');
    expect(findings[0]?.message).toContain('sync_shelf_placement');
    expect(findings[0]?.counterexample).toMatchObject({ invariants: 'INV-SHELF-002 / INV-SHELF-003' });
  });

  it('境界: 不変条件を 1 つも持たないモデルでは何も生成しない', () => {
    const empty = specModel({
      aggregates: [aggregate({ name: 'shelf', entity: entitySpec('shelf', [field('name', { kind: 'string' })]) })],
    });

    expect(constraintInvariantsGenerator.generate(empty, GEN_CTX)).toEqual([]);
  });
});
