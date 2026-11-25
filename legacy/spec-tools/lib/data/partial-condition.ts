/**
 * **ガード式を、条件の原子の連言へ読み替える**(T5・T23)。
 *
 * 不変条件の `where` はガード式、索引・排他制約の `where` は SQL 断片である。どちらも「自分の列の原子」の連言に読み替えて比べる。読める形は下の表だけで、
 * ほかは全部 `null`(比べられない)を返す。推測で読まない。SQL 断片の読み手は、実 DB の印字も読む生成テストと共有するので `@kaninabe/runtime/sql/sql-condition` にある。
 *
 * | 原子 | ガード式 |
 * |---|---|
 * | `in`(値の集合) | `x == a` / `x in [a, b]` |
 * | `not_in`(値の集合) | `x != a` / `x not in [a, b]` |
 * | `null` / `not_null` | `x is null` / `x is not null` |
 *
 * 純関数であり throw しない。
 */

import { conditionAtom, type ConditionAtom } from '@kaninabe/runtime/sql/sql-condition';
import type { GuardExpr } from '../guard/ast.js';

export { atomsOfSql, sameAtoms, type ConditionAtom } from '@kaninabe/runtime/sql/sql-condition';

/** パスの列(裸の列か、自分の集約の列だけを読む)。 */
function columnOf(path: readonly string[], entity: string): string | null {
  if (path.length === 1) return path[0] ?? null;
  return path.length === 2 && path[0] === entity ? (path[1] ?? null) : null;
}

/** 否定を原子へ畳む。 */
function negated(inner: ConditionAtom): ConditionAtom {
  const flip = { in: 'not_in', not_in: 'in', null: 'not_null', not_null: 'null' } as const;
  return { ...inner, op: flip[inner.op] };
}

/** ガード式の原子 1 つ。 */
function guardAtom(expr: GuardExpr, entity: string): ConditionAtom | null {
  if (expr.kind === 'not') {
    const inner = guardAtom(expr.operand, entity);
    return inner === null ? null : negated(inner);
  }
  if (expr.kind === 'in') {
    const column = columnOf(expr.path.segments, entity);
    return column === null ? null : conditionAtom(column, 'in', expr.values.map((value) => String(value.value)));
  }
  if (expr.kind === 'null') {
    const column = columnOf(expr.path.segments, entity);
    return column === null ? null : conditionAtom(column, 'null', []);
  }
  if (expr.kind !== 'compare' || expr.rhs.kind === 'path' || (expr.op !== '==' && expr.op !== '!=')) return null;
  const column = columnOf(expr.path.segments, entity);
  return column === null ? null : conditionAtom(column, expr.op === '==' ? 'in' : 'not_in', [String(expr.rhs.value)]);
}

/**
 * ガード式を原子の連言に読む。
 *
 * @param expr ガード式
 * @param entity 自分の集約の綴り(`{集約}.{列}` の形を読む)
 * @returns 原子の並び(読めない形を含めば null)
 */
export function atomsOfGuard(expr: GuardExpr, entity: string): readonly ConditionAtom[] | null {
  if (expr.kind === 'and') {
    const left = atomsOfGuard(expr.left, entity);
    const right = atomsOfGuard(expr.right, entity);
    return left === null || right === null ? null : [...left, ...right];
  }
  const single = guardAtom(expr, entity);
  return single === null ? null : [single];
}
