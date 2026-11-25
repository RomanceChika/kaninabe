/**
 * 保存点の複合 RPC の口(`createUsecaseRepository`)のテスト。
 *
 * 署名の 5 本の引数で RPC を 1 回呼ぶこと・効果を追っていないので受領の要求の写しは `null` であること・
 * 拒否と失敗の分類が定型 RPC の口と同じ 1 つの写像であることを確かめる。
 */

import { describe, expect, it } from 'vitest';
import { createUsecaseRepository } from '../usecase.repository';
import { invariantOf, pgError, receiptOfSaved, sourceOf } from '../../__tests__/fakes/rpc-source';

describe('createUsecaseRepository（複合 RPC の口）', () => {
  it('署名の 5 本の引数で RPC を 1 回呼び、文書を受領に載せる。効果を追っていないので要求の写しは null（空の配列ではない）', async () => {
    const { source, calls } = sourceOf({ data: { 'widget.create': { id: 'a' } }, error: null });
    const outcome = await createUsecaseRepository(source, invariantOf).call('usecase_widget_register', {
      id: 'a',
      actorId: 'actor-1',
      actorRoles: ['member'],
      expected: { 'parent.state': 'open' },
      input: { 'widget.create': { title: 'あ' } },
    });

    expect(calls).toEqual([
      {
        name: 'usecase_widget_register',
        args: {
          p_id: 'a',
          p_actor_id: 'actor-1',
          p_actor_roles: ['member'],
          p_expected: { 'parent.state': 'open' },
          p_input: { 'widget.create': { title: 'あ' } },
        },
      },
    ]);
    expect(receiptOfSaved(outcome)).toEqual({
      returned: { shape: 'document', document: { 'widget.create': { id: 'a' } } },
      requestedEffects: null,
      outbox: 'unknown',
    });
  });

  it('拒否と失敗の分類は定型 RPC の口と同じ（写像は 1 か所）', async () => {
    const args = { id: 'a', actorId: null, actorRoles: [], expected: {}, input: {} };
    const conflict = await createUsecaseRepository(sourceOf({ data: null, error: pgError({ code: 'UC409', message: 'usecase_conflict:w.x' }) }).source, invariantOf).call('f', args);
    const down = await createUsecaseRepository(sourceOf({ data: null, error: pgError({ message: 'TypeError: fetch failed' }) }).source, invariantOf).call('f', args);

    expect(conflict).toEqual({ kind: 'conflict', op: 'w.x' });
    expect(down).toMatchObject({ kind: 'transport_failed', commit: 'unknown' });
  });
});
