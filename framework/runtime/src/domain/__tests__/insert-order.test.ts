/**
 * world の行を入れる順(`@kaninabe/runtime/testing/pg/insert-order`)の単体テスト。実 DB は使わない(カタログの答えを固定して渡す)。
 *
 * 見るのは 3 点である。
 *   1. 遅延できない外部キーの参照先が先に来るように並べ直す(設計図の順では参照先が後ろ向きに残るとき)
 *   2. 遅延できる外部キーは順序の制約に数えない(循環の逃げ道)・動かす必要が無い行は元の順のまま
 *   3. 遅延できない辺だけで循環していれば並べ直せず、残りを元の順に出す(throw しない。実 DB の拒否に任せる)
 *
 * 表名・列名は仮の語である。
 */

import { describe, expect, it } from 'vitest';
import { orderForInsert } from '@kaninabe/runtime/testing/pg/insert-order';
import type { CatalogQueryable, OrderableRow } from '@kaninabe/runtime/testing/pg/insert-order';

/** 遅延できない外部キーの列を答えるカタログ。 */
function catalog(...immediate: readonly string[]): CatalogQueryable {
  return {
    query: <R extends Record<string, unknown>>() =>
      Promise.resolve({
        rows: immediate.map((entry) => {
          const [table_name, column_name] = entry.split('.');
          return { table_name, column_name } as unknown as R;
        }),
      }),
  };
}

const row = (key: string, table: string, refs: Readonly<Record<string, string>> = {}): OrderableRow => ({ key, table, refs });

describe('orderForInsert', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-007
  it('遅延できない外部キーの参照先を先に並べ直す(循環の遅延できる辺は後ろ向きに残す)', async () => {
    // person.invited_via(遅延できない) → invite、invite.issued_by(遅延できる) → person の循環。設計図は person が先。
    const rows = [row('other', 'person', { invited_via: 'invite' }), row('invite', 'invite', { issued_by: 'other' }), row('self', 'person', { invited_via: 'invite' })];
    const ordered = await orderForInsert(catalog('person.invited_via'), rows);
    expect(ordered.map((entry) => entry.key)).toEqual(['invite', 'other', 'self']);
  });

  it('並べ直す必要が無ければ元の順のまま・自分自身への参照は制約に数えない', async () => {
    const rows = [row('a', 'node', { parent: 'a' }), row('b', 'node', { parent: 'a' })];
    const ordered = await orderForInsert(catalog('node.parent'), rows);
    expect(ordered.map((entry) => entry.key)).toEqual(['a', 'b']);
    expect(await orderForInsert(catalog(), [])).toEqual([]);
  });

  it('遅延できない辺だけで循環していれば、並べ直さず元の順に出す', async () => {
    const rows = [row('x', 'node', { peer: 'y' }), row('y', 'node', { peer: 'x' })];
    const ordered = await orderForInsert(catalog('node.peer'), rows);
    expect(ordered.map((entry) => entry.key)).toEqual(['x', 'y']);
  });
});
