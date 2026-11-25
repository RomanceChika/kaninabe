/**
 * 集約どうしの重さと従属(所有の向き)の導出のテスト(book-human-face.md §7-3)。
 *
 * 世界は小さく作る: 親(状態機械・編集・削除)・親の行を動かす人だけが作る子・外の人が作る子・内部実行だけが作る子・
 * 親が 2 つ残る子・孫。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateOwnership,
  aggregateWeights,
  cascadeReach,
  compareWeights,
  descendantsOf,
  rootOf,
  weightTotal,
  type AggregateWeight,
} from '../../../lib/semantics/aggregate-structure.js';
import { dataTable } from '../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  entitySpec,
  event,
  field,
  loc,
  machine,
  role,
  roleSpec,
  specModel,
  write,
} from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 親を `ref` で指す子の集約(作る人と消す人を渡す)。 */
function childOf(name: string, parents: readonly string[], creators: readonly string[], deleters: readonly string[] = creators) {
  return aggregate(name, {
    entity: entitySpec(name, {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        ...parents.map((parent) => field(`${parent}_id`, { kind: 'ref', entity: parent }, { required: true })),
      ],
    }),
    access: accessSpec(name, { creates: creators.map((by) => create(by)), deletes: deleters.map((by) => del(by)) }),
  });
}

/** 親(2 本の状態の流れと、編集・削除を持つ)。作るのは誰でもよいメンバー。 */
function parentOf(name: string, actors: readonly string[]) {
  return aggregate(name, {
    entity: entitySpec(name, { fields: [field('id', { kind: 'uuid' }, { auto: true })] }),
    stateMachines: [
      machine(name, {
        states: ['a', 'b'],
        initial: 'a',
        events: [event('go', { from: ['a'], to: 'b', by: [...actors] })],
      }),
    ],
    access: accessSpec(name, {
      creates: [create('member')],
      writes: actors.map((by) => write(by, ['id'])),
      deletes: actors.map((by) => del(by)),
    }),
    invariants: {
      invariants: [{ id: `INV-${name.toUpperCase()}-001`, statement: '文', entities: [name], enforcedBy: [], location: loc() }],
      location: loc(`docs/specs/domain/${name}/invariants.md`),
    },
  });
}

const roles = roleSpec([
  role('anonymous'),
  role('member'),
  role('system'),
  role('organizer', 'x.organizer_id == actor.id', ['member']),
  role('owner', 'y.owner_id == actor.id', ['member']),
]);

const fk = (references: string) => [{ column: 'x_id', references, onDelete: 'cascade' as const }];

/** 世界: top(organizer が動かす)と mid(member が作る・owner が動かす)と、それぞれの子。 */
const model = specModel(
  [
    parentOf('top', ['organizer']),
    parentOf('mid', ['owner', 'organizer']),
    childOf('slot', ['top'], ['organizer']),
    childOf('mirror', ['top'], ['system']),
    childOf('leaf', ['mirror'], ['system']),
    childOf('guest', ['top'], ['member']),
    childOf('shared', ['top', 'mid'], ['organizer']),
    childOf('lonely', [], ['organizer']),
  ],
  roles,
);
const tables = [
  dataTable('tops', { entity: 'top' }),
  dataTable('mids', { entity: 'mid', foreignKeys: fk('tops') }),
  dataTable('slots', { entity: 'slot', foreignKeys: fk('tops') }),
  dataTable('mirrors', { entity: 'mirror', foreignKeys: fk('tops') }),
  dataTable('leaves', { entity: 'leaf', foreignKeys: fk('mirrors') }),
  dataTable('guests', { entity: 'guest', foreignKeys: fk('tops') }),
  dataTable('shareds', { entity: 'shared', foreignKeys: [...fk('tops'), ...fk('mids')] }),
  dataTable('lonelies', { entity: 'lonely' }),
];

describe('weightTotal / compareWeights(重さの式と同点の規則は 1 か所)', () => {
  it('重さ = 入次数 + 公理の数 + 操作の数', () => {
    expect(weightTotal({ inDegree: 3, invariants: 4, operations: 5 })).toBe(12);
  });

  it('同点は 入次数 → 公理 → 操作 → 名前の辞書順。仕様の並びには依らない', () => {
    const w = (name: string, inDegree: number, invariants: number, operations: number): AggregateWeight => ({
      name,
      inDegree,
      invariants,
      operations,
      total: weightTotal({ inDegree, invariants, operations }),
    });
    const tied = [w('d', 1, 1, 3), w('c', 2, 1, 2), w('b', 1, 2, 2), w('a', 1, 2, 2), w('e', 0, 0, 0)];

    // 合計はどれも 5(e を除く)。入次数の多い c、次に公理の多い a と b(名前順)、最後に d。
    expect([...tied].sort(compareWeights).map((weight) => weight.name)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect([...tied].reverse().sort(compareWeights).map((weight) => weight.name)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
});

describe('aggregateWeights', () => {
  it('入次数は ref で指す別の集約の数、操作は状態機械とエンティティに結ばれた操作仕様の数', () => {
    const weights = aggregateWeights(model, [actionSpec({ handles: 'top.go' }), actionSpec({ handles: 'top.create' }), actionSpec({ handles: 'slot.create' })]);
    const top = weights.find((weight) => weight.name === 'top');

    // top を指すのは slot・mirror・guest・shared の 4 つ。公理 1 本。操作 2 本。
    expect(top).toEqual({ name: 'top', inDegree: 4, invariants: 1, operations: 2, total: 7 });
    expect(weights[0]?.name).toBe('top');
  });
});

describe('aggregateOwnership(従属 = cascade + 作る・消すロールが親の行を動かす人)', () => {
  const weights = aggregateWeights(model, []);
  const ownership = aggregateOwnership(model, tables, weights);

  it('作る・消すロールがすべて親の行を動かす人なら、従属する', () => {
    expect(ownership.owned.get('slot')?.parent).toBe('top');
  });

  it('親の外のロール(メンバー)が作るなら、cascade でつながっていても従属しない(自分の動かし手を持つ)', () => {
    expect(ownership.owned.has('guest')).toBe(false);
    expect(ownership.cascadeOnly.get('guest')).toEqual(['top']);
  });

  it('内部実行のロールは比べない。内部実行だけが作る子は、親からの写しとして従属する', () => {
    expect(ownership.owned.get('mirror')?.parent).toBe('top');
  });

  it('従属は連鎖する(孫は親を辿って根に着く)', () => {
    expect(ownership.owned.get('leaf')?.parent).toBe('mirror');
    expect(rootOf(ownership, 'leaf')).toBe('top');
    expect(rootOf(ownership, 'top')).toBe('top');
    expect(descendantsOf(ownership, weights, 'top').sort()).toEqual(['leaf', 'mirror', 'shared', 'slot']);
  });

  it('cascade の親が無い集約は従属しない', () => {
    expect(ownership.owned.has('lonely')).toBe(false);
    expect(ownership.owned.has('top')).toBe(false);
    expect(ownership.cascadeOnly.has('lonely')).toBe(false);
  });

  it('親が 2 つ残るときは、入次数の多いほうを親にする(候補は両方残る)', () => {
    const by = ownership.owned.get('shared');

    // top は 4 つの集約から参照され、mid は 1 つ(shared だけ)。
    expect(by?.parent).toBe('top');
    expect([...(by?.candidates ?? [])].sort()).toEqual(['mid', 'top']);
  });

  it('表の仕様が無い環境では従属は無い', () => {
    expect(aggregateOwnership(model, [], weights).owned.size).toBe(0);
  });
});

describe('cascadeReach(消すと一緒に消えるものを、連なる先まで)', () => {
  it('従属かどうかを問わず、cascade で連なる集約を名前順に返す', () => {
    const weights = aggregateWeights(model, []);
    const ownership = aggregateOwnership(model, tables, weights);

    expect(ownership.owned.size).toBeGreaterThan(0);
    expect(cascadeReach(tables, model, 'top')).toEqual(['guest', 'leaf', 'mid', 'mirror', 'shared', 'slot']);
    expect(cascadeReach(tables, model, 'lonely')).toEqual([]);
  });
});
