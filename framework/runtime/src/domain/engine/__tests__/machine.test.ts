/**
 * 遷移可否判定（canFire / isFinal）のテスト。
 *
 * 網羅の基準は「状態 × イベント × ロール × ガード」の各拒否理由に1つ以上の確認があること。
 * 表は docs/specs/domain/entry/states.md（エントリーの状態機械）をテスト内にリテラル構築したもの。
 */

import { describe, expect, it } from 'vitest';
import { canFire, isFinal, knownEvents, transitionOf } from '../machine';
import type { AllowedTransition, FireDecision } from '../machine';
import type { GuardEnv, MachineTable } from '@kaninabe/runtime/engine/types';

/** 許可された遷移の中身を取り出す（拒否だったらテストを落とす）。 */
function allowedTransition(decision: FireDecision): AllowedTransition {
  if (!decision.allowed) throw new Error(`許可されませんでした: ${decision.reason}`);
  return transitionOf(decision);
}

/** エントリーの状態機械（手書き。生成物と同じ形） */
const entryMachine: MachineTable = {
  machine: 'entry',
  states: ['draft', 'submitted', 'accepted', 'rejected', 'withdrawn'],
  initial: 'draft',
  final: ['rejected', 'withdrawn'],
  transitions: [
    {
      event: 'submit',
      from: ['draft'],
      to: 'submitted',
      by: ['performer'],
      guard: {
        kind: 'compare',
        path: 'workshop.state',
        op: '==',
        rhs: { kind: 'literal', value: 'accepting' },
      },
      guardSource: 'workshop.state == accepting',
      otherwiseForbidden: '提出は下書きからのみ',
      effects: ['notify_organizer_new_entry'],
    },
    {
      event: 'revise',
      from: ['submitted'],
      to: 'draft',
      by: ['performer'],
      guard: {
        kind: 'compare',
        path: 'workshop.state',
        op: '==',
        rhs: { kind: 'literal', value: 'accepting' },
      },
      guardSource: 'workshop.state == accepting',
      effects: [],
    },
    {
      event: 'accept',
      from: ['submitted'],
      to: 'accepted',
      by: ['organizer'],
      guard: { kind: 'in', path: 'workshop.state', values: ['accepting', 'closed'] },
      guardSource: 'workshop.state in [accepting, closed]',
      effects: ['notify_performer_accepted'],
    },
    {
      event: 'withdraw',
      from: ['submitted', 'accepted'],
      to: 'withdrawn',
      by: ['performer', 'organizer'],
      guard: {
        kind: 'compare',
        path: 'workshop.state',
        op: '!=',
        rhs: { kind: 'literal', value: 'program_published' },
      },
      guardSource: 'workshop.state != program_published',
      effects: ['notify_organizer_withdrawn'],
    },
  ],
};

/** ガードを持たない遷移を含む最小の表。 */
const noteMachine: MachineTable = {
  machine: 'note',
  states: ['open', 'archived'],
  initial: 'open',
  final: ['archived'],
  transitions: [
    { event: 'archive', from: ['open'], to: 'archived', by: ['organizer'], effects: [] },
  ],
};

const accepting: GuardEnv = { 'workshop.state': 'accepting' };

describe('canFire — 許可', () => {
  it('受付中の催しでは出演者が下書きを提出できる', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: accepting },
      'submit',
    );
    expect(decision.allowed).toBe(true);
    expect(allowedTransition(decision)).toEqual({
      event: 'entry.submit',
      from: 'draft',
      to: 'submitted',
      effects: ['notify_organizer_new_entry'],
    });
  });

  it('from が複数のイベントはどの遷移元からも発火できる', () => {
    const from = (state: string) =>
      canFire(entryMachine, { state, actorRoles: ['organizer'], env: accepting }, 'withdraw');
    expect(allowedTransition(from('submitted'))).toMatchObject({ from: 'submitted', to: 'withdrawn' });
    expect(allowedTransition(from('accepted'))).toMatchObject({ from: 'accepted', to: 'withdrawn' });
  });

  it('実行者のロールが by のいずれかに含まれれば許可する', () => {
    const decision = canFire(
      entryMachine,
      { state: 'submitted', actorRoles: ['member', 'organizer'], env: accepting },
      'accept',
    );
    expect(allowedTransition(decision)).toMatchObject({ to: 'accepted' });
  });

  it('ガードの無い遷移は常に許可する', () => {
    const decision = canFire(noteMachine, { state: 'open', actorRoles: ['organizer'], env: {} }, 'archive');
    expect(allowedTransition(decision)).toEqual({
      event: 'note.archive',
      from: 'open',
      to: 'archived',
      effects: [],
    });
  });
});

describe('canFire — 拒否', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-TABLE-001
  it('表に無いイベントは unknown_event として拒否する', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: accepting },
      'publish',
    );
    expect(decision).toEqual({
      allowed: false,
      event: 'publish',
      state: 'draft',
      reason: 'unknown_event',
      knownEvents: ['submit', 'revise', 'accept', 'withdraw'],
    });
  });

  it('from に無い状態からの発火は invalid_from として拒否し、期待される遷移元と仕様の理由文を返す', () => {
    const decision = canFire(
      entryMachine,
      { state: 'accepted', actorRoles: ['performer'], env: accepting },
      'submit',
    );
    expect(decision).toEqual({
      allowed: false,
      event: 'submit',
      state: 'accepted',
      reason: 'invalid_from',
      expectedFrom: ['draft'],
      otherwiseForbidden: '提出は下書きからのみ',
    });
  });

  it('仕様に理由文が無ければ invalid_from の otherwiseForbidden は undefined になる', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: accepting },
      'accept',
    );
    expect(decision).toMatchObject({ reason: 'invalid_from' });
    if (decision.allowed || decision.reason !== 'invalid_from') return;
    expect(decision.otherwiseForbidden).toBeUndefined();
  });

  it('from が複数のイベントでは期待される遷移元を重複なく列挙する', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: accepting },
      'withdraw',
    );
    expect(decision).toMatchObject({
      reason: 'invalid_from',
      expectedFrom: ['submitted', 'accepted'],
    });
  });

  it('by に無いロールの実行者は role_forbidden として拒否し、許可ロールを返す', () => {
    const decision = canFire(
      entryMachine,
      { state: 'submitted', actorRoles: ['performer'], env: accepting },
      'accept',
    );
    expect(decision).toEqual({
      allowed: false,
      event: 'accept',
      state: 'submitted',
      reason: 'role_forbidden',
      allowedRoles: ['organizer'],
      actorRoles: ['performer'],
    });
  });

  it('ロールを1つも持たない実行者は role_forbidden として拒否する', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: [], env: accepting },
      'submit',
    );
    expect(decision).toMatchObject({ reason: 'role_forbidden', allowedRoles: ['performer'] });
  });

  it('ガードが成立しなければ guard_unsatisfied として拒否し、元のガード式を返す', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: { 'workshop.state': 'closed' } },
      'submit',
    );
    expect(decision).toEqual({
      allowed: false,
      event: 'submit',
      state: 'draft',
      reason: 'guard_unsatisfied',
      guardSource: 'workshop.state == accepting',
    });
  });

  it('ガードの評価に必要な値が env に無ければ guard_unknown として拒否する', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: {} },
      'submit',
    );
    expect(decision).toEqual({
      allowed: false,
      event: 'submit',
      state: 'draft',
      reason: 'guard_unknown',
      guardSource: 'workshop.state == accepting',
      unresolvedPaths: ['workshop.state'],
    });
  });

  it('ガードの評価で型が食い違えば guard_unknown として拒否し、未解決パスは空になる', () => {
    const decision = canFire(
      entryMachine,
      { state: 'draft', actorRoles: ['performer'], env: { 'workshop.state': 3 } },
      'submit',
    );
    expect(decision).toMatchObject({ reason: 'guard_unknown', unresolvedPaths: [] });
  });

  it('ロールの判定はガードより先に行う', () => {
    const decision = canFire(
      entryMachine,
      { state: 'submitted', actorRoles: ['performer'], env: {} },
      'accept',
    );
    expect(decision).toMatchObject({ reason: 'role_forbidden' });
  });
});

describe('isFinal / knownEvents', () => {
  it('final に含まれる状態を終端と判定する', () => {
    expect(isFinal(entryMachine, 'withdrawn')).toBe(true);
    expect(isFinal(entryMachine, 'rejected')).toBe(true);
  });

  it('final に含まれない状態は終端ではない', () => {
    expect(isFinal(entryMachine, 'submitted')).toBe(false);
    expect(isFinal(entryMachine, 'draft')).toBe(false);
  });

  it('知らない状態は終端ではない', () => {
    expect(isFinal(entryMachine, 'nonexistent')).toBe(false);
  });

  it('イベントIDを表の出現順に重複なく列挙する', () => {
    expect(knownEvents(entryMachine)).toEqual(['submit', 'revise', 'accept', 'withdraw']);
  });

  it('同じイベントが複数の遷移に現れても1つだけ列挙する', () => {
    // 同一イベントが遷移元ごとに複数行に分かれる表（`to` が違うので1行にまとめられない）。
    const ticketMachine: MachineTable = {
      machine: 'ticket',
      states: ['open', 'held', 'closed', 'void'],
      initial: 'open',
      final: ['closed', 'void'],
      transitions: [
        { event: 'close', from: ['open'], to: 'closed', by: ['organizer'], effects: [] },
        { event: 'close', from: ['held'], to: 'void', by: ['organizer'], effects: [] },
      ],
    };
    expect(knownEvents(ticketMachine)).toEqual(['close']);
  });
});
