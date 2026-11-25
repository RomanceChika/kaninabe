/**
 * 不変条件からアクティブ状態集合を導く純粋モジュールのテスト。
 *
 * 対象の要求: 「`state not in [...]` の形の where からだけ導く。肯定形(数える対象の集合)は
 * アクティブの定義ではない。結論が食い違う候補が複数あるなら何も導かない」。
 */

import { describe, expect, it } from 'vitest';
import { activeStatesFromInvariants } from '../../../../lib/generate/render/state-sets.js';
import type { InvariantDef, InvariantFormal } from '../../../../lib/model/types.js';
import { loc, machine } from '../../../helpers/model-builder.js';
import { createGuardServices } from '../../../../lib/guard/services.js';

const GUARDS = createGuardServices();

/** entry の 5 状態を持つ機械。 */
const ENTRY = machine('entry', {
  states: ['draft', 'submitted', 'accepted', 'rejected', 'withdrawn'],
  initial: 'draft',
  final: ['rejected', 'withdrawn'],
});

/** 不変条件 1 件。formal を渡さないと「DSL 外」の不変条件になる。 */
function invariant(id: string, formal?: InvariantFormal): InvariantDef {
  return {
    id,
    statement: `${id} の宣言文`,
    entities: ['entry'],
    ...(formal === undefined ? {} : { formal }),
    enforcedBy: [],
    location: loc('docs/specs/domain/entry/invariants.md', `invariants.${id}`),
  };
}

/** uniqueness の where 付き。 */
function uniqueness(where: string): InvariantFormal {
  return { kind: 'uniqueness', keys: ['workshop_id', 'performer_id'], where };
}

/** 導出を実行する。 */
function derive(invariants: readonly InvariantDef[]) {
  return activeStatesFromInvariants(ENTRY, invariants, ['entry'], GUARDS);
}

describe('activeStatesFromInvariants', () => {
  it('state not in [...] の補集合を状態機械の宣言順で返す', () => {
    const result = derive([
      invariant('INV-ENTRY-001', uniqueness('entry.state not in [rejected, withdrawn]')),
    ]);

    expect(result?.states).toEqual(['draft', 'submitted', 'accepted']);
    expect(result?.sources).toEqual(['INV-ENTRY-001']);
  });

  it('裸のフィールド名(state)でも導ける', () => {
    expect(derive([invariant('INV-A', uniqueness('state not in [withdrawn]'))])?.states).toEqual([
      'draft',
      'submitted',
      'accepted',
      'rejected',
    ]);
  });

  it('肯定形(state in [...])はアクティブの定義ではないので導かない', () => {
    // 「定員を数える対象」であって「まだ生きているもの」ではない。
    const result = derive([
      invariant('INV-ENTRY-002', {
        kind: 'cardinality',
        keys: ['workshop_id'],
        max: 'workshop.capacity',
        where: 'entry.state in [submitted, accepted]',
      }),
    ]);

    expect(result).toBeNull();
  });

  it('否定形と肯定形が混ざっていても、否定形だけを見る', () => {
    const result = derive([
      invariant('INV-ENTRY-001', uniqueness('entry.state not in [rejected, withdrawn]')),
      invariant('INV-ENTRY-002', {
        kind: 'cardinality',
        keys: ['workshop_id'],
        max: 10,
        where: 'entry.state in [submitted, accepted]',
      }),
    ]);

    expect(result?.states).toEqual(['draft', 'submitted', 'accepted']);
    expect(result?.sources).toEqual(['INV-ENTRY-001']);
  });

  it('結論が一致する候補が複数あれば、根拠を全部並べる', () => {
    const result = derive([
      invariant('INV-A', uniqueness('entry.state not in [rejected, withdrawn]')),
      invariant('INV-B', uniqueness('state not in [rejected, withdrawn]')),
    ]);

    expect(result?.sources).toEqual(['INV-A', 'INV-B']);
  });

  it('結論が食い違う候補が複数あれば何も導かない(どちらかを選ぶ根拠が仕様に無い)', () => {
    const result = derive([
      invariant('INV-A', uniqueness('entry.state not in [rejected, withdrawn]')),
      invariant('INV-B', uniqueness('entry.state not in [withdrawn]')),
    ]);

    expect(result).toBeNull();
  });

  it('where が無い・状態以外のフィールド・複合式は対象にしない', () => {
    expect(derive([invariant('INV-A', { kind: 'uniqueness', keys: ['id'] })])).toBeNull();
    expect(derive([invariant('INV-B', uniqueness('entry.title not in [x]'))])).toBeNull();
    expect(
      derive([invariant('INV-C', uniqueness('entry.state not in [rejected] and state != draft'))]),
    ).toBeNull();
  });

  it('別エンティティ前置の state は対象にしない', () => {
    expect(derive([invariant('INV-A', uniqueness('workshop.state not in [draft]'))])).toBeNull();
  });

  it('不変条件が 1 件も無ければ null', () => {
    expect(derive([])).toBeNull();
  });
});
