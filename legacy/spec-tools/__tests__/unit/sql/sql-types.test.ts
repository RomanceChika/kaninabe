/**
 * 列 → 式の写像(`sql-types.ts` の `columnExpression`)のユニットテスト。
 *
 * この 1 本に、値の出どころ 3 通り(jsonb の袋・1 欄ずつ受ける引数・保存点の複合 RPC が
 * 入力から取り出す式)が全部乗っている。固定するのは 2 つだけである:
 *   - 型が同じなら**何も足さない**(字面が長くなるだけの cast を出さない)
 *   - 型が違えば列の型へ cast する(jsonb の `->>` が返す text はここで戻る)
 *
 * 経路ごとに cast の規則を持っていた頃、個別引数の経路だけがキャストを持たず
 * `text` の引数を `timestamptz` の列へ入れる SQL が生成されていた(束 ③-2 の実測)。
 */

import { describe, expect, it } from 'vitest';
import { columnExpression, columnType, JSON_TEXT_TYPE } from '../../../lib/sql/sql-types.js';

describe('列 → 式の写像', () => {
  it('型が同じなら何も足さない', () => {
    expect(columnExpression('p_title', 'text', { kind: 'string' })).toBe('p_title');
    expect(columnExpression('p_room_id', 'uuid', { kind: 'ref', entity: 'room' })).toBe('p_room_id');
  });

  it('型が違えば列の型へ cast する', () => {
    expect(columnExpression('p_starts_at', 'text', { kind: 'datetime' })).toBe('(p_starts_at)::timestamptz');
    expect(columnExpression('p_count', 'text', { kind: 'integer' })).toBe('(p_count)::integer');
  });

  it('jsonb から取り出した値は text なので、text 以外の列では cast が付く', () => {
    expect(columnExpression("p_values ->> 'companion_count'", JSON_TEXT_TYPE, { kind: 'integer' })).toBe(
      "(p_values ->> 'companion_count')::integer",
    );
    expect(columnExpression("p_values ->> 'note'", JSON_TEXT_TYPE, { kind: 'text' })).toBe("p_values ->> 'note'");
  });

  it('enum と state は text の列なので cast が付かない(値の値域は CHECK が見る)', () => {
    expect(columnExpression("p_values ->> 'purpose'", JSON_TEXT_TYPE, { kind: 'enum', values: ['a'] })).toBe(
      "p_values ->> 'purpose'",
    );
    expect(columnType({ kind: 'state', machine: 'booking' })).toBe('text');
  });
});
