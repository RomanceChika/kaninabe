/**
 * 持ち主の一覧と「読めなかった種類」を、id と読み込みの成否から 1 つの関数で組み立てる(`scopeUniverseOf`。入力は id と真偽値だけ。モデルは読まない)。
 *
 * 配線(パイプライン)が持っていた組み立てを `lib/scope` に集めたので、ここで直に見る:
 *   - 読み込みが error なく済んだ種類(`clean`)は、`unloaded` に載らない。済まなかった種類だけが載る(採っている種類のうち)
 *   - デザイントークンは `catalogs.designTokens` が false のとき `design_tokens` が載る
 *   - ドメイン仕様の読み込みに error があれば `invariantsUnloaded`(不変条件の持ち主は種類を持たないので別の欄)
 *   - 持ち主は、読めたカタログの分だけ(読めなかった種類の持ち主は載らない)
 */

import { describe, expect, it } from 'vitest';
import type { ProductUses, SpecKind } from '../../../lib/model/product/uses.js';
import { SPEC_KINDS } from '../../../lib/model/product/uses.js';
import { scopeUniverseOf, type ScopeUniverseInput } from '../../../lib/scope/universe.js';

/** 全部読めた入力(id と読めたかどうかだけ。モデルは持たない。持ち主の中身は owners.ts のテストが見る)。 */
function input(overrides: Partial<ScopeUniverseInput> = {}): ScopeUniverseInput {
  return {
    uses: SPEC_KINDS as ProductUses,
    actionIds: ['room-create-action'],
    scanEvents: ['booking.expire'],
    queryIds: [],
    screenIds: [],
    tableIds: [],
    usecaseIds: [],
    invariantIds: [],
    catalogs: { jobs: true, auth: true, guarantees: true, external: true, config: true, designTokens: true },
    clean: {},
    domainClean: true,
    ...overrides,
  };
}

describe('scopeUniverseOf', () => {
  it('全部読めていれば、unloaded は空で invariantsUnloaded は false', () => {
    const universe = scopeUniverseOf(input());

    expect(universe.unloaded).toEqual([]);
    expect(universe.invariantsUnloaded).toBe(false);
    expect(universe.owners).toContainEqual({ kind: 'action', id: 'room-create-action' });
    expect(universe.owners).toContainEqual({ kind: 'scan', id: 'booking.expire' });
  });

  it.each(['actions', 'queries', 'screens', 'data_tables', 'usecases', 'jobs', 'auth', 'guarantees', 'external', 'config'] as const)('%s の読み込みが済まなければ、その種類だけが unloaded に載る', (kind: SpecKind) => {
    const universe = scopeUniverseOf(input({ clean: { [kind]: false } }));

    expect(universe.unloaded).toEqual([kind]);
  });

  it('デザイントークンを読めなければ design_tokens が載り、持ち主にも載らない', () => {
    const universe = scopeUniverseOf(input({ catalogs: { jobs: true, auth: true, guarantees: true, external: true, config: true, designTokens: false } }));

    expect(universe.unloaded).toEqual(['design_tokens']);
    expect(universe.owners.some((owner) => owner.id === 'design-tokens')).toBe(false);
  });

  it('採っていない種類は、読めなくても unloaded に載らない', () => {
    const universe = scopeUniverseOf(input({ uses: ['actions'], clean: { queries: false } }));

    expect(universe.unloaded).toEqual([]);
  });

  it('ドメイン仕様の読み込みに error があれば invariantsUnloaded', () => {
    expect(scopeUniverseOf(input({ domainClean: false })).invariantsUnloaded).toBe(true);
  });
});
