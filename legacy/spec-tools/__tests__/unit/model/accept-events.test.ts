/**
 * 遷移の受け入れの名指しを遷移の定義に解く部品(`accept-events.ts`。点検 5 回目 A5-1)のテスト。
 *
 * 名指しは `{ID}` か `{ID}@{遷移元の状態}`。受け入れのロールで起こせる定義の**ちょうど 1 本**に解けたときだけ効き、当たらない・曖昧は
 * 区別して返す(V2 が error にする)。表で正例・負例・境界を網羅する。
 */

import { describe, expect, it } from 'vitest';
import { acceptEventSpellings, parseAcceptEventRef, resolveAcceptEvent } from '../../../lib/model/accept-events.js';
import type { EventDef } from '../../../lib/model/types-state.js';

/** 遷移の定義 1 本。 */
function event(id: string, from: readonly string[], by: readonly string[], to = 'suspended'): EventDef {
  return { id, from, to, by, location: { file: 'states.md' } } as EventDef;
}

const ACTIVE = event('suspend', ['active'], ['company_admin']);
const PENDING = event('suspend', ['pending'], ['company_admin']);
const BOTH = event('suspend', ['active', 'pending'], ['company_admin']);
const STAFF = event('suspend', ['frozen'], ['staff']);
const ACTIVATE = event('activate', ['pending'], ['system'], 'active');

describe('parseAcceptEventRef', () => {
  it.each([
    ['suspend', { id: 'suspend', from: null }],
    ['suspend@active', { id: 'suspend', from: 'active' }],
    ['_x1@s_2', { id: '_x1', from: 's_2' }],
    ['suspend@', null],
    ['@active', null],
    ['suspend@active@x', null],
    ['suspend#active', null],
    ['sus pend', null],
    ['1suspend', null],
    ['', null],
  ] as const)('%s', (raw, expected) => {
    expect(parseAcceptEventRef(raw)).toEqual(expected);
  });
});

describe('resolveAcceptEvent', () => {
  /** [題, 名指し, 定義の全部, ロール, 期待(ok の定義 / 種類)]。 */
  const CASES: readonly (readonly [string, string, readonly EventDef[], string, EventDef | 'unknown' | 'malformed' | readonly EventDef[]])[] = [
    ['ID が 1 本だけ', 'suspend', [ACTIVE, ACTIVATE], 'company_admin', ACTIVE],
    ['同じ ID が 2 本 → ID だけは曖昧', 'suspend', [ACTIVE, PENDING], 'company_admin', [ACTIVE, PENDING]],
    ['遷移元で絞れば 1 本(1 本目)', 'suspend@active', [ACTIVE, PENDING], 'company_admin', ACTIVE],
    ['遷移元で絞れば 1 本(2 本目)', 'suspend@pending', [ACTIVE, PENDING], 'company_admin', PENDING],
    ['遷移元が重なると絞っても曖昧(境界)', 'suspend@pending', [BOTH, PENDING], 'company_admin', [BOTH, PENDING]],
    ['重ならない遷移元なら絞れる', 'suspend@active', [BOTH, PENDING], 'company_admin', BOTH],
    ['ほかのロールの同じ ID は数えない', 'suspend', [ACTIVE, STAFF], 'company_admin', ACTIVE],
    ['そのロールで起こせない ID → 当たらない', 'activate', [ACTIVE, ACTIVATE], 'company_admin', 'unknown'],
    ['無い ID → 当たらない', 'cancel', [ACTIVE], 'company_admin', 'unknown'],
    ['どの定義の遷移元にも無い状態 → 当たらない', 'suspend@suspended', [ACTIVE, PENDING], 'company_admin', 'unknown'],
    ['形が違う', 'suspend@', [ACTIVE], 'company_admin', 'malformed'],
  ];

  it.each(CASES)('%s', (_title, raw, events, by, expected) => {
    const resolved = resolveAcceptEvent(raw, events, by);
    if (expected === 'unknown' || expected === 'malformed') expect(resolved.kind).toBe(expected);
    else if (Array.isArray(expected)) expect(resolved).toEqual({ kind: 'ambiguous', events: expected });
    else expect(resolved).toEqual({ kind: 'ok', event: expected });
  });
});

describe('acceptEventSpellings', () => {
  it.each([
    ['同じ ID がほかに無ければ ID だけ', ACTIVE, [ACTIVE, ACTIVATE], ['suspend']],
    ['同じ ID があれば遷移元で絞る', ACTIVE, [ACTIVE, PENDING], ['suspend@active']],
    ['重ならない遷移元だけを出す', BOTH, [BOTH, PENDING], ['suspend@active']],
    ['遷移元で分けられなければ空', PENDING, [BOTH, PENDING], []],
    ['ほかのロールの同じ ID は数えない', ACTIVE, [ACTIVE, STAFF], ['suspend']],
  ] as const)('%s', (_title, target, events, expected) => {
    expect(acceptEventSpellings(target, events, 'company_admin')).toEqual(expected);
  });
});
