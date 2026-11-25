/**
 * 「誰に見えるか」の共有部品(render/book/access-view.ts)のテスト。
 *
 * スコープの日本語化(⚠ の付与)・隠しフィールドの引き当て・依存 query の逆引き
 * (via があればそのロール、無ければ for。source と併読の両方)を検める。
 */

import { describe, expect, it } from 'vitest';

import {
  dependentQueries,
  hiddenFieldsFor,
  readKey,
  scopeJa,
} from '../../../../../lib/generate/render/book/access-view.js';
import { accessSpec, read } from '../../../../helpers/model-builder.js';
import { querySpec } from '../../../../helpers/query-builder.js';

describe('scopeJa: スコープの日本語化', () => {
  it('all にだけ ⚠ を付け、context は対象エンティティを埋め込む', () => {
    expect(scopeJa({ kind: 'all' })).toBe('全件(all) ⚠');
    expect(scopeJa({ kind: 'own' })).toBe('自分のものだけ(own)');
    expect(scopeJa({ kind: 'none' })).toBe('見えない(none)');
    expect(scopeJa({ kind: 'context', entity: 'workshop' })).toBe(
      '紐づく workshop のものだけ(context(workshop))',
    );
  });
});

describe('hiddenFieldsFor: 隠しフィールドの引き当て', () => {
  it('そのロールが from に入っている規則のフィールドだけを返す', () => {
    const access = accessSpec('entry', {
      reads: [read('member', 'none')],
      fieldsHidden: [
        { field: 'note', from: ['member'], location: { file: 'docs/specs/domain/entry/access.md' } },
        { field: 'title', from: ['anonymous'], location: { file: 'docs/specs/domain/entry/access.md' } },
      ],
    });

    expect(hiddenFieldsFor(access, 'member')).toBe('note');
    expect(hiddenFieldsFor(access, 'organizer')).toBe('');
  });
});

describe('dependentQueries: 依存 query の逆引き', () => {
  it('via があればそのロール、無ければ for の各ロールに乗る(source と併読の両方)', () => {
    const queries = [
      querySpec({ name: 'own_list', source: 'entry', for: ['member'], via: 'performer', scopeUsed: 'own' }),
      querySpec({
        name: 'detail',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        returns: 'one',
        includes: [{ entity: 'entry', scopeUsed: 'own', via: 'performer' }],
      }),
    ];

    const index = dependentQueries({ available: true, queries });

    // source: via 指定 → for の member ではなく performer に乗る
    expect(index.get(readKey('entry', 'performer'))).toEqual(['own_list', 'detail']);
    expect(index.get(readKey('entry', 'member'))).toBeUndefined();
    // via 無し → for のロールに乗る
    expect(index.get(readKey('workshop', 'member'))).toEqual(['detail']);
  });

  it('query_spec を読めていなければ空の索引を返す', () => {
    expect(dependentQueries(undefined).size).toBe(0);
    expect(dependentQueries({ available: false, queries: [] }).size).toBe(0);
  });
});
