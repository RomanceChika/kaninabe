/**
 * 部分索引の条件の読み替え(`partial-condition.ts`。点検 13 回目 A13-1)のテスト。
 *
 * 表: ガード式と SQL 断片の綴りの組 × 同じ / 違う。読めない形は null(推測で読まない)。
 */

import { describe, expect, it } from 'vitest';
import { atomsOfGuard, atomsOfSql, sameAtoms } from '../../../lib/data/partial-condition.js';
import { parseFormalGuard } from '../../../lib/guard/parser.js';

/** ガード式を読む。 */
function guardAtoms(source: string): ReturnType<typeof atomsOfGuard> {
  const parsed = parseFormalGuard(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return atomsOfGuard(parsed.expr, 'order');
}

describe('atomsOfGuard / atomsOfSql', () => {
  it.each([
    { guard: 'state != archived', sql: "(state <> 'archived'::text)" },
    { guard: 'state != archived', sql: "state != 'archived'" },
    { guard: 'state not in [returned]', sql: "(state <> 'returned'::text)" },
    { guard: 'state not in [collected, cancelled]', sql: "(state <> ALL (ARRAY['collected'::text, 'cancelled'::text]))" },
    { guard: 'state not in [cancelled, collected]', sql: "state not in ('collected', 'cancelled')" },
    { guard: 'state in [a, b]', sql: "state = ANY (ARRAY['a'::text, 'b'::text])" },
    { guard: 'state in [a, b]', sql: "state IN ('b', 'a')" },
    { guard: 'state == a', sql: "state = 'a'" },
    { guard: 'order.is_open == true', sql: 'is_open = true' },
    { guard: 'order.note is not null', sql: 'note is not null' },
    { guard: 'note is null', sql: '(note IS NULL)' },
    { guard: 'state == a and order.note is not null', sql: "((state = 'a'::text) AND (note IS NOT NULL))" },
  ])('同じ: $guard ⇔ $sql', ({ guard, sql }) => {
    const left = guardAtoms(guard);
    const right = atomsOfSql(sql);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(sameAtoms(left ?? [], right ?? [])).toBe(true);
  });

  it.each([
    { guard: 'state != archived', sql: "state = 'archived'" },
    { guard: 'state != archived', sql: "state <> 'draft'" },
    { guard: 'state not in [a, b]', sql: "state <> 'a'" },
    { guard: 'note is null', sql: 'note is not null' },
    { guard: 'order.is_open == true', sql: 'is_open = false' },
    { guard: 'state == a and order.note is not null', sql: "state = 'a'" },
  ])('違う: $guard ⇎ $sql', ({ guard, sql }) => {
    expect(sameAtoms(guardAtoms(guard) ?? [], atomsOfSql(sql) ?? [])).toBe(false);
  });

  it.each(['price > 0', 'lower(name) = \'a\'', "state = 'a' or state = 'b'", 'state = other_column', "state like 'a%'", 'a = 1'])('読めない SQL は null: %s', (sql) => {
    expect(atomsOfSql(sql)).toBeNull();
  });

  it.each(['price > 0', 'state == a or state == b', 'parent.state == a', 'state == order.other'])('読めないガード式は null: %s', (guard) => {
    expect(guardAtoms(guard)).toBeNull();
  });

  it("引用符の中の 'and' は分けない側に倒す(読めない形になり通らない)", () => {
    expect(atomsOfSql("state = 'a and b'")).toBeNull();
  });
});
