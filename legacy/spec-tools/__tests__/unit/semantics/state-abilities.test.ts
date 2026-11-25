/**
 * 各状態でロールができること(`semantics/state-abilities.ts`。結果表のロールの列の元)のテスト。
 *
 * 世界は小さく作る: 親(状態機械: open → closed → done)と、親の状態を条件にして作る子・別の状態機械の遷移・
 * 条件が状態にふれない規則。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import type { GuardExpr } from '../../../lib/guard/ast.js';
import { parseGuard } from '../../../lib/guard/parser.js';
import { abilitiesByState, approximateStates, type StateAbility } from '../../../lib/semantics/state-abilities.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  entitySpec,
  event,
  field,
  machine,
  read,
  specModel,
  write,
} from '../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['open', 'closed', 'done'],
  initial: 'open',
  final: ['done'],
  events: [
    event('close', { from: ['open'], to: 'closed', by: ['guest'], label: '閉じる' }),
    event('finish', { from: ['open', 'closed'], to: 'done', by: ['host'], label: '終える' }),
  ],
});

const owner = aggregate('thing', {
  entity: entitySpec('thing', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'flow' })] }),
  stateMachines: [flow],
  access: accessSpec('thing', {
    reads: [read('guest', 'all'), read('hidden', 'none'), read('timed', 'all', undefined, 'state != done')],
    writes: [write('guest', ['title'], 'state == open'), write('guest', ['note'])],
    deletes: [del('guest', 'not state in [closed, done]')],
  }),
});

const child = aggregate('part', {
  entity: entitySpec('part', { fields: [field('thing_id', { kind: 'ref', entity: 'thing' })] }),
  stateMachines: [
    machine('part_flow', {
      states: ['x', 'y'],
      initial: 'x',
      events: [
        event('join', { from: ['x'], to: 'y', by: ['guest'], label: '加わる', guard: 'thing.state in [open, closed] and now < thing.starts_at' }),
        event('leave', { from: ['y'], to: 'x', by: ['guest'], label: '抜ける' }),
        event('either', { from: ['x'], to: 'y', by: ['guest'], label: 'どちらか', guard: 'thing.state == open or thing.starts_at == 1' }),
      ],
    }),
  ],
  access: accessSpec('part', {
    creates: [create('guest', 'thing.state == open and thing.capacity > 0'), create('host', 'thing.state == open'), create('guest', 'thing.capacity > 0')],
    deletes: [del('guest', 'state == x')],
  }),
});

const model = specModel([owner, child]);

/** できることを `種類:集約:呼び名` の文字列にして状態ごとに返す。 */
function abilities(roles: readonly string[], source = owner, target = flow): Record<string, string[]> {
  const found = abilitiesByState(model, source, target, new Set(roles));
  const text = (ability: StateAbility): string => `${ability.kind}:${ability.aggregate}${ability.label === '' ? '' : `:${ability.label}`}`;
  return Object.fromEntries([...found].map(([state, list]) => [state, list.map(text)]));
}

describe('abilitiesByState', () => {
  it('親の状態機械の遷移は、from の状態でできる。読み取りは、状態で絞っていなければ全状態でできる(見えない宣言は除く)', () => {
    // host: finish は open と closed、子の作成(thing.state == open)は open。
    expect(abilities(['host'])).toEqual({
      open: ['event:thing:終える', 'create:part'],
      closed: ['event:thing:終える'],
      done: [],
    });
    // guest は読める(read all)。timed は state != done なので done では読めない。
    expect(abilities(['timed'])).toEqual({ open: ['read:thing'], closed: ['read:thing'], done: [] });
    expect(abilities(['hidden'])).toEqual({ open: [], closed: [], done: [] });
  });

  it('別の集約の作成・別の状態機械の遷移は、条件が親の状態を指すとき、その状態でできる(状態以外の原子は通す)', () => {
    const result = abilities(['guest']);

    // 子の作成: thing.state == open and thing.capacity > 0 → open のみ。条件に状態が無い作成は載せない。
    expect(result.open).toContain('create:part');
    expect(result.closed).not.toContain('create:part');
    // 子の遷移 join: thing.state in [open, closed] and now < ... → open と closed。leave は条件が状態にふれないので載せない。
    expect(result.open).toContain('event:part:加わる');
    expect(result.closed).toContain('event:part:加わる');
    expect(result.done).not.toContain('event:part:加わる');
    expect(JSON.stringify(result)).not.toContain('抜ける');
  });

  it('自分の集約の規則は、裸の state を親の状態として読む。!= と not と in と == を状態の集合にする', () => {
    const result = abilities(['guest']);

    // 書く: state == open → open。条件の無い書くは載せない。
    expect(result.open).toContain('write:thing');
    expect(result.closed).not.toContain('write:thing');
    // 消す: not state in [closed, done] → open。
    expect(result.open).toContain('delete:thing');
    expect(result.closed).not.toContain('delete:thing');
    // 子の消す(state == x)は、子の集約の裸の state なので、親の状態ではない。
    expect((result.open ?? []).filter((text) => text === 'delete:part')).toEqual([]);
  });

  it('or は、状態以外の原子が混ざると全状態に広がる(成り立つかもしれない)', () => {
    const result = abilities(['guest']);

    expect(result.done).toContain('event:part:どちらか');
  });

  it('同じできることは 1 状態に 1 回だけ数える', () => {
    const result = abilities(['guest', 'host']);

    expect((result.open ?? []).filter((text) => text === 'create:part')).toHaveLength(1);
  });

  it('状態を持つ欄の無い集約・エンティティの無い集約には、できることが無い', () => {
    const bare = aggregate('bare', { stateMachines: [flow] });

    expect(abilities(['guest'], bare)).toEqual({ open: [], closed: [], done: [] });
  });

  it('式が読めないときは、その規則を載せない(例外にしない)', () => {
    const broken = aggregate('broken', {
      entity: entitySpec('broken', { fields: [field('thing_id', { kind: 'ref', entity: 'thing' })] }),
      access: accessSpec('broken', { creates: [create('guest', 'thing.state ==')] }),
    });
    const world = specModel([owner, broken]);
    const found = abilitiesByState(world, owner, flow, new Set(['guest']));

    expect([...found.values()].flat().some((ability) => ability.aggregate === 'broken')).toBe(false);
  });
});

const STATES = ['open', 'closed', 'done'];

/** 式の木を近似して、状態の集合(並び順を固定)とぴったりかどうかを返す。 */
function approximateExpr(expr: GuardExpr): { states: string[] | null; exact: boolean } {
  const result = approximateStates(expr, 'thing', 'state', false, STATES);
  return { states: result.states === null ? null : [...result.states].sort(), exact: result.exact };
}

/** 条件の文字列を読んで近似する。 */
function approximate(source: string): { states: string[] | null; exact: boolean } {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`式が読めない: ${source}`);
  return approximateExpr(parsed.expr);
}

/** `thing.state == {value}`(状態の原子)。 */
const isState = (value: string): GuardExpr => ({ kind: 'compare', path: { segments: ['thing', 'state'] }, op: '==', rhs: { kind: 'symbol', value } });
/** `now < thing.starts_at`(時刻の原子)。 */
const beforeStart: GuardExpr = { kind: 'compare', path: { segments: ['now'] }, op: '<', rhs: { kind: 'path', path: { segments: ['thing', 'starts_at'] } } };
/** `thing.capacity > 0`(欄の値の原子)。 */
const hasRoom: GuardExpr = { kind: 'compare', path: { segments: ['thing', 'capacity'] }, op: '>', rhs: { kind: 'number', value: 0 } };

describe('approximateStates(できるかもしれない状態と、ぴったりかどうか)', () => {
  it('状態の原子だけの式はぴったり: 単一の状態・and・or・単純な not', () => {
    expect(approximate('thing.state == open')).toEqual({ states: ['open'], exact: true });
    expect(approximate('thing.state in [open, closed] and thing.state != open')).toEqual({ states: ['closed'], exact: true });
    expect(approximate('thing.state == open or thing.state == done')).toEqual({ states: ['done', 'open'], exact: true });
    expect(approximate('not thing.state == open')).toEqual({ states: ['closed', 'done'], exact: true });
  });

  it('状態の原子だけの式の二重否定は、ぴったりのまま元の集合に戻る', () => {
    const inner: GuardExpr = { kind: 'or', left: isState('open'), right: isState('closed') };

    expect(approximateExpr({ kind: 'not', operand: { kind: 'not', operand: inner } })).toEqual({ states: ['closed', 'open'], exact: true });
  });

  it('時刻の原子が混ざる式の not は補集合を取らない: 全状態の may にする(木は文法に書けないが、近似は木の形に依らず安全にする)', () => {
    // 「open かつ締切前」の否定は、open でも締切後ならできる。補集合 {closed, done} だと open を落とす。
    const compound: GuardExpr = { kind: 'not', operand: { kind: 'and', left: isState('open'), right: beforeStart } };

    expect(approximateExpr(compound)).toEqual({ states: null, exact: false });
  });

  it('欄の値の原子が混ざる or の not も、補集合を取らない', () => {
    const compound: GuardExpr = { kind: 'not', operand: { kind: 'or', left: isState('open'), right: hasRoom } };

    expect(approximateExpr(compound)).toEqual({ states: null, exact: false });
  });

  it('ぴったりでない式を包む二重否定も、ぴったりにならない', () => {
    const compound: GuardExpr = { kind: 'and', left: isState('open'), right: beforeStart };

    expect(approximateExpr({ kind: 'not', operand: { kind: 'not', operand: compound } })).toEqual({ states: null, exact: false });
  });

  it('ぴったりでない式の and / or は、集合は合成するがぴったりとは言わない', () => {
    // and: 状態の絞りは残る(may)が、時刻の原子があるのでぴったりではない。
    expect(approximate('thing.state == open and now < thing.starts_at')).toEqual({ states: ['open'], exact: false });
    // or: 時刻の原子の側が全状態を通すので全状態。
    expect(approximate('thing.state == open or now < thing.starts_at')).toEqual({ states: null, exact: false });
  });

  it('状態以外の原子 1 つの not は、全状態の may のまま(状態の絞りを作らない)', () => {
    expect(approximate('not now < thing.starts_at')).toEqual({ states: null, exact: false });
  });
});
