/**
 * 手書きのリポジトリの口(`createHandwrittenRpc`)のテスト(点検 27 回目 B27-1)。
 *
 * 確かめるのは 3 つ —— ①書けたら戻りの値をそのまま返す ②DB の業務の拒否(UC403 / UC412 / UC409)と制約の違反は戻り値の拒否になり、
 * 投げない(それまで並べ忘れたリポジトリは HTTP 500 にしていた) ③通信の失敗・想定外の失敗・呼び出しの例外はコミットの状態つきで投げる。
 * 拒否を持たない約束の `rpcOrThrow` は、拒否も `not_committed` の失敗として投げる。
 */

import { describe, expect, it } from 'vitest';
import { DbInfrastructureError } from '@kaninabe/runtime/ports';
import { createHandwrittenRpc, invariantResolverOf } from '../handwritten-rpc';
import { pgError, sourceOf } from '../../__tests__/fakes/rpc-source';

// 製品の DB の型と同じく型の別名で書く(interface は添字の署名を持たないので口の制約に合わない)。
type WidgetFunctions = {
  readonly erase_widget: { readonly Args: { readonly p_id: string }; readonly Returns: readonly { readonly id: string }[] };
};

const resolver = invariantResolverOf({ widgets_title_key: 'INV-WIDGET-001' });

/** 投げたものを取り出す(投げなければ失敗)。 */
async function rejection(promise: Promise<unknown>): Promise<DbInfrastructureError> {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof DbInfrastructureError) return cause;
    throw cause;
  }
  throw new Error('投げなかった');
}

describe('createHandwrittenRpc', () => {
  it('書けたら戻りの値をそのまま返し、引数はそのまま渡す', async () => {
    const { source, calls } = sourceOf({ data: [{ id: 'w1' }], error: null, status: 200 });
    const rpc = createHandwrittenRpc<WidgetFunctions>(source, resolver);
    expect(await rpc.rpc('erase_widget', { p_id: 'w1' })).toEqual({ refused: null, reason: null, error: null, data: [{ id: 'w1' }] });
    expect(calls).toEqual([{ name: 'erase_widget', args: { p_id: 'w1' } }]);
  });

  it.each([
    ['UC403', 'forbidden'],
    ['UC412', 'guard_unsatisfied'],
    ['UC409', 'conflict'],
  ] as const)('業務の拒否 %s は投げずに conflict の拒否になる(元の分類 %s を残す)', async (code, reason) => {
    const error = pgError({ code, message: 'usecase_forbidden:membership.erase' });
    const rpc = createHandwrittenRpc<WidgetFunctions>(sourceOf({ data: null, error, status: 400 }).source, resolver);
    expect(await rpc.rpc('erase_widget', { p_id: 'w1' })).toEqual({ refused: { kind: 'conflict' }, reason, error, data: null });
  });

  it('制約の違反は不変条件の拒否になる(制約名の表で引く)', async () => {
    const error = pgError({ code: '23505', message: 'duplicate key value violates unique constraint "widgets_title_key"' });
    const rpc = createHandwrittenRpc<WidgetFunctions>(sourceOf({ data: null, error, status: 409 }).source, resolver);
    expect((await rpc.rpc('erase_widget', { p_id: 'w1' })).refused).toEqual({ kind: 'invariant_violated', invariant: 'INV-WIDGET-001' });
  });

  it('想定外の失敗と呼び出しの例外は、コミットの状態つきで投げる', async () => {
    const internal = createHandwrittenRpc<WidgetFunctions>(sourceOf({ data: null, error: pgError({ code: 'XX000' }), status: 500 }).source, resolver);
    expect(await rejection(internal.rpc('erase_widget', { p_id: 'w1' }))).toMatchObject({ where: 'erase_widget', kind: 'unknown_failure', commit: 'unknown' });
    const thrown = createHandwrittenRpc<WidgetFunctions>(sourceOf(new Error('socket hang up')).source, resolver);
    expect(await rejection(thrown.rpc('erase_widget', { p_id: 'w1' }))).toMatchObject({ kind: 'transport_failed', commit: 'unknown' });
  });

  it('rpcOrThrow は書けたら値を返し、業務の拒否は not_committed の失敗として投げる', async () => {
    const ok = createHandwrittenRpc<WidgetFunctions>(sourceOf({ data: [{ id: 'w1' }], error: null }).source, resolver);
    expect(await ok.rpcOrThrow('erase_widget', { p_id: 'w1' })).toEqual([{ id: 'w1' }]);
    const refused = createHandwrittenRpc<WidgetFunctions>(sourceOf({ data: null, error: pgError({ code: 'UC409' }), status: 400 }).source, resolver);
    expect(await rejection(refused.rpcOrThrow('erase_widget', { p_id: 'w1' }))).toMatchObject({ kind: 'unknown_failure', commit: 'not_committed', sqlstate: 'UC409' });
  });

  it('invariantResolverOf は表に無い字面なら undefined', () => {
    expect(resolver('nothing here')).toBeUndefined();
    expect(resolver('violates "widgets_title_key"')).toBe('INV-WIDGET-001');
  });
});
