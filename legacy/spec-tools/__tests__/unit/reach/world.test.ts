/**
 * 有界到達性の**世界の決め方**(lib/reach/world.ts)の単体テスト。
 *
 * 仕様: docs/design/v21-bounded-reachability.md §2「世界(SMT に写す形)」
 *
 * ここで固定するのは 4 つ —— 関与する機械の閉包・欄が手ごとに自由か実行中不変か・
 * 裸の欄と他集約からの参照が**同じ 1 本の変数**になること・K の作り方(積 − 1、上限 128)。
 * どれも「緩める側に外れているか」を決める軸であり、間違えると V21 が嘘の warning を出す。
 */

import { describe, expect, it } from 'vitest';
import { MAX_BOUND, buildWorld } from '../../../lib/reach/world.js';
import { loosenActorAtoms } from '../../../lib/reach/actor.js';
import { parseGuard } from '../../../lib/guard/parser.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  writeRule,
} from '../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 親(open → closed)と、親の状態を見る子。子は裸の `state` でも自分の状態を書く。 */
function twoAggregates(writable: readonly string[] = []): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'parent',
        entity: entitySpec('parent', [
          field('state', { kind: 'state', machine: 'parent' }),
          field('deadline', { kind: 'datetime' }),
        ]),
        stateMachines: [
          machine({
            machine: 'parent',
            states: ['open', 'closed'],
            events: [event({ id: 'close', from: ['open'], to: 'closed' })],
          }),
        ],
        access: accessSpec('parent', {
          writes: writable.length === 0 ? [] : [writeRule('member', writable)],
        }),
      }),
      aggregate({
        name: 'child',
        entity: entitySpec('child', [field('state', { kind: 'state', machine: 'child' })]),
        stateMachines: [
          machine({
            machine: 'child',
            states: ['draft', 'done'],
            events: [
              event({
                id: 'finish',
                from: ['draft'],
                to: 'done',
                guard: 'state == draft and parent.state == closed and now >= parent.deadline',
              }),
            ],
          }),
        ],
        access: accessSpec('child'),
      }),
    ],
  });
}

describe('buildWorld — 関与する機械', () => {
  it('ガードが参照する集約の機械を世界に入れる(親の機械が入る)', () => {
    const world = buildWorld(twoAggregates(), 'child', 'child');

    expect(world.machines.map((entry) => entry.id)).toEqual(['child.child', 'parent.parent']);
  });

  it('参照していない側は相手を世界に入れない(親の世界は親だけ)', () => {
    const world = buildWorld(twoAggregates(), 'parent', 'parent');

    expect(world.machines.map((entry) => entry.id)).toEqual(['parent.parent']);
  });

  it('K は関与する機械の状態数の積 − 1 である', () => {
    expect(buildWorld(twoAggregates(), 'child', 'child').bound).toBe(2 * 2 - 1);
    expect(buildWorld(twoAggregates(), 'parent', 'parent').bound).toBe(1);
  });
});

describe('buildWorld — 手ごとに自由か実行中不変か', () => {
  it('`writes` に無い欄は実行中不変(手ごとの変数にしない)', () => {
    const world = buildWorld(twoAggregates(), 'child', 'child');

    expect(world.perStep.has('parent.deadline')).toBe(false);
  });

  it('`writes` に並ぶ欄は手ごとに自由(誰かがいつでも書ける)', () => {
    const world = buildWorld(twoAggregates(['deadline']), 'child', 'child');

    expect(world.perStep.has('parent.deadline')).toBe(true);
  });

  it('状態変数と `now` は常に手ごとに動く', () => {
    const world = buildWorld(twoAggregates(), 'child', 'child');

    expect(world.perStep.has('now')).toBe(true);
    expect(world.perStep.has('child.state')).toBe(true);
    expect(world.perStep.has('parent.state')).toBe(true);
  });

  it('裸の欄は自分の集約の欄として正規化される(同じものが 2 変数に割れない)', () => {
    const world = buildWorld(twoAggregates(), 'child', 'child');
    const finish = world.machines.find((entry) => entry.id === 'child.child')?.events[0];

    expect(finish?.paths.get('state')).toBe('child.state');
    expect(finish?.paths.get('parent.state')).toBe('parent.state');
    expect(finish?.paths.get('now')).toBe('now');
  });
});

describe('buildWorld — 参照される機械だけを入れる', () => {
  /** a → b → c と状態変数を辿る 3 機械(c は誰も参照しない d を持つ)。 */
  function chain(): SpecModel {
    return specModel({
      roles: [role('member'), role('system')],
      aggregates: [
        aggregate({
          name: 'chain',
          entity: entitySpec('chain', [
            field('a', { kind: 'state', machine: 'a' }),
            field('b', { kind: 'state', machine: 'b' }),
            field('c', { kind: 'state', machine: 'c' }),
            field('d', { kind: 'state', machine: 'd' }),
          ]),
          stateMachines: [
            machine({
              machine: 'a',
              states: ['a0', 'a1'],
              events: [event({ id: 'ea', from: ['a0'], to: 'a1', guard: 'chain.b == b1' })],
            }),
            machine({
              machine: 'b',
              states: ['b0', 'b1'],
              events: [event({ id: 'eb', from: ['b0'], to: 'b1', guard: 'chain.c == c1' })],
            }),
            machine({ machine: 'c', states: ['c0', 'c1'], events: [event({ id: 'ec', from: ['c0'], to: 'c1' })] }),
            machine({ machine: 'd', states: ['d0', 'd1'], events: [event({ id: 'ed', from: ['d0'], to: 'd1' })] }),
          ],
          access: accessSpec('chain'),
        }),
      ],
    });
  }

  it('同じ集約にあるだけの機械は入らない(誰も状態変数を読んでいない)', () => {
    const world = buildWorld(chain(), 'chain', 'c');

    expect(world.machines.map((entry) => entry.id)).toEqual(['chain.c']);
    expect(world.bound).toBe(1);
  });

  it('同じ集約の 2 つ目の機械でも、状態変数を読んでいれば入る', () => {
    const world = buildWorld(chain(), 'chain', 'b');

    expect(world.machines.map((entry) => entry.id)).toEqual(['chain.b', 'chain.c']);
  });

  it('参照は推移的に辿る(a → b → c。誰も読まない d は入らない)', () => {
    const world = buildWorld(chain(), 'chain', 'a');

    expect(world.machines.map((entry) => entry.id)).toEqual(['chain.a', 'chain.b', 'chain.c']);
    expect(world.bound).toBe(2 * 2 * 2 - 1);
  });
});

describe('buildWorld — K の打ち切り', () => {
  it('状態数の積が大きい世界は上限で打ち切り、打ち切ったことを報告する', () => {
    const states = ['s0', 's1', 's2', 's3', 's4', 's5'];
    const model = specModel({
      roles: [role('member'), role('system')],
      aggregates: [
        aggregate({
          name: 'wide',
          entity: entitySpec('wide', [
            field('a', { kind: 'state', machine: 'a' }),
            field('b', { kind: 'state', machine: 'b' }),
            field('c', { kind: 'state', machine: 'c' }),
          ]),
          stateMachines: [
            machine({
              machine: 'a',
              states,
              events: [event({ id: 'ea', from: ['s0'], to: 's1', guard: 'wide.b == s1 and wide.c == s1' })],
            }),
            machine({ machine: 'b', states }),
            machine({ machine: 'c', states }),
          ],
          access: accessSpec('wide'),
        }),
      ],
    });

    const world = buildWorld(model, 'wide', 'a');

    expect(world.bound).toBe(MAX_BOUND);
    expect(world.truncated).toBe(true);
  });
});

describe('loosenActorAtoms — 誰が実行するかを見ない', () => {
  /** 式を読む(読めない式はテストの書き間違い)。 */
  function parse(source: string) {
    const parsed = parseGuard(source);
    expect(parsed.ok, source).toBe(true);
    if (!parsed.ok) throw new Error(source);
    return parsed.expr;
  }

  it('実行者に触れる比較は自由な真偽値へ逃げる(原子ごとに別)', () => {
    const loosened = loosenActorAtoms(parse('doc.owner_id == actor.id and doc.editor_id == actor.id'));

    expect(loosened.kind).toBe('and');
    if (loosened.kind !== 'and') return;
    expect(loosened.left.kind).toBe('contains');
    expect(loosened.right.kind).toBe('contains');
    expect(JSON.stringify(loosened.left)).not.toBe(JSON.stringify(loosened.right));
  });

  it('実行者に触れない比較はそのまま残る', () => {
    const source = parse('doc.state == draft');

    expect(loosenActorAtoms(source)).toEqual(source);
  });

  it('参照の表は書かれたままの式から作る(閉包が縮まない)', () => {
    const world = buildWorld(
      specModel({
        roles: [role('member'), role('system')],
        aggregates: [
          aggregate({
            name: 'parent',
            entity: entitySpec('parent', [
              field('state', { kind: 'state', machine: 'parent' }),
              field('owner_id', { kind: 'uuid' }),
            ]),
            stateMachines: [
              machine({
                machine: 'parent',
                states: ['open', 'closed'],
                events: [event({ id: 'close', from: ['open'], to: 'closed' })],
              }),
            ],
            access: accessSpec('parent'),
          }),
          aggregate({
            name: 'child',
            entity: entitySpec('child', [field('state', { kind: 'state', machine: 'child' })]),
            stateMachines: [
              machine({
                machine: 'child',
                states: ['draft', 'done'],
                events: [
                  event({ id: 'finish', from: ['draft'], to: 'done', guard: 'parent.state == closed and parent.owner_id == actor.id' }),
                ],
              }),
            ],
            access: accessSpec('child'),
          }),
        ],
      }),
      'child',
      'child',
    );

    expect(world.machines.map((entry) => entry.id)).toEqual(['child.child', 'parent.parent']);
  });
});

describe('buildWorld — 2 段の context を辿るパス', () => {
  it('`{集約}.{中継}.{欄}` は機械の状態変数にならない(自由な値として緩む側に寄る)', () => {
    const model = specModel({
      roles: [role('member'), role('system')],
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('state', { kind: 'state', machine: 'workshop' })]),
          stateMachines: [
            machine({
              machine: 'workshop',
              states: ['open', 'closed'],
              events: [event({ id: 'close', from: ['open'], to: 'closed' })],
            }),
          ],
          access: accessSpec('workshop'),
        }),
        aggregate({
          name: 'piece',
          entity: entitySpec(
            'piece',
            [field('state', { kind: 'state', machine: 'piece' })],
            { entry: 'entry_id' },
          ),
          stateMachines: [
            machine({
              machine: 'piece',
              states: ['draft', 'fixed'],
              // 2 段の中継を辿るパス(V2 が `context` で解決する形)。
              events: [event({ id: 'fix', from: ['draft'], to: 'fixed', guard: 'piece.workshop.state == closed' })],
            }),
          ],
          access: accessSpec('piece'),
        }),
      ],
    });

    const world = buildWorld(model, 'piece', 'piece');
    const fix = world.machines.find((entry) => entry.id === 'piece.piece')?.events[0];

    // 中継を辿った先は workshop の状態変数(`workshop.state`)**ではない**ので、
    // その機械は世界に入らない —— 代わりに自由な値になるだけで、充足側にしか外れない。
    expect(world.machines.map((entry) => entry.id)).toEqual(['piece.piece']);
    expect(fix?.paths.get('piece.workshop.state')).toBe('piece.workshop.state');
    expect(world.perStep.has('piece.workshop.state')).toBe(true);
  });
});
