/**
 * 汎用の事実リーダー(`createFactReader`)のテスト。
 *
 * 確かめるのは 3 つ —— ①表・列・行を指定して 1 行を引き、ガード式が扱えるスカラーだけを写す(列が無い・
 * `null` は `null`、集合・オブジェクトは載せない)②行が無ければ `null` ③読み取りの失敗は握りつぶさず投げる。
 * 口は `RowSource`(PostgREST の `from().select().eq().maybeSingle()` の形)だけを置き換える。
 */

import { describe, expect, it } from 'vitest';
import { createFactReader } from '../fact.reader';
import type { RowSource } from '../fact.reader';
import type { PostgrestErrorLike } from '../../rpc/rpc-outcome';

/** 呼び出しの記録つきの口(決めた応答を返す)。 */
function sourceOf(response: { data: unknown; error: PostgrestErrorLike | null }): {
  readonly source: RowSource;
  readonly calls: { table: string; columns: string; column: string; value: string }[];
} {
  const calls: { table: string; columns: string; column: string; value: string }[] = [];
  const source: RowSource = {
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => {
          calls.push({ table, columns, column, value });
          return { maybeSingle: () => Promise.resolve(response) };
        },
      }),
    }),
  };
  return { source, calls };
}

describe('createFactReader（保存点の外の 1 行を読む口）', () => {
  it('表・列を指定して id で 1 行を引き、スカラーだけを事実として写す', async () => {
    const { source, calls } = sourceOf({
      data: { state: 'open', capacity: 3, visible: true, note: null, tags: ['a'], owner: { id: 'x' } },
      error: null,
    });

    const facts = await createFactReader(source).readFields('widgets', 'w-1', ['state', 'capacity', 'visible', 'note', 'missing', 'tags', 'owner']);

    expect(calls).toEqual([
      { table: 'widgets', columns: 'state,capacity,visible,note,missing,tags,owner', column: 'id', value: 'w-1' },
    ]);
    // 行に無い列(`missing`)は null。集合・オブジェクト(`tags` / `owner`)は載せない(エンジンが guard_unknown と診断する)。
    expect(facts).toEqual({ state: 'open', capacity: 3, visible: true, note: null, missing: null });
  });

  it('行が無ければ null（行でない値も null）', async () => {
    const none = await createFactReader(sourceOf({ data: null, error: null }).source).readFields('widgets', 'w-1', ['state']);
    const scalar = await createFactReader(sourceOf({ data: 'x', error: null }).source).readFields('widgets', 'w-1', ['state']);

    expect(none).toBeNull();
    expect(scalar).toBeNull();
  });

  it('読み取りの失敗は握りつぶさず、表の名前つきで投げる', async () => {
    const error = { code: '42501', message: 'permission denied for view widgets', details: null, hint: null };
    const reader = createFactReader(sourceOf({ data: null, error }).source);

    // 手書きのリポジトリと同じ型(DbInfrastructureError。点検 19 回目 B19-1)。DB の文言はメッセージに載せず cause にだけ入れる。
    const thrown = await reader.readFields('widgets', 'w-1', ['state']).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(thrown).toMatchObject({ name: 'DbInfrastructureError', where: 'widgets の取得', kind: 'unknown_failure', sqlstate: '42501', cause: error });
    expect((thrown as Error).message).not.toContain('permission denied');
  });
});
