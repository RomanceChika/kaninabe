/**
 * エンジンの拒否 → `ActionError`（ARCH-BE-0013 の3分類）への写像のテスト。
 *
 * 網羅の基準は「`FireRejectionReason` / `CreateRejectionReason` の各値に1つ以上の確認があること」と
 * 「理由文が仕様から来る場合と、仕様に理由文が無い場合の双方を確かめること」。行カバレッジではない。
 * 拒否は `canFire` / `canCreate` の戻り値の形をそのままリテラル構築して渡す（エンジンは通さない）。
 */

import { describe, expect, it } from 'vitest';
import { toActionError, toCreateActionError } from '../action-error';
import type { CreateRejected, FireRejected } from '@kaninabe/runtime/engine';

const EVENT_ID = 'entry.submit';
const CREATE_EVENT_ID = 'entry.create';
const ACTOR_ROLE = 'member';

describe('toActionError', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-REFUSAL-001
  it('表に無いイベントは状態で塞がれた拒否として写す', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'publish',
      state: 'draft',
      reason: 'unknown_event',
      knownEvents: ['submit', 'withdraw'],
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toEqual({
      kind: 'guard_unsatisfied',
      event: EVENT_ID,
      blockedBy: 'state',
      reason: 'unknown_event: publish',
    });
  });

  it('invalid_from の理由文は仕様の otherwise_forbidden をそのまま載せる', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'submit',
      state: 'accepted',
      reason: 'invalid_from',
      expectedFrom: ['draft'],
      otherwiseForbidden: '提出は下書きからのみ',
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toMatchObject({
      blockedBy: 'state',
      reason: '提出は下書きからのみ',
    });
  });

  it('仕様に理由文が無い invalid_from は期待される遷移元を診断として返す', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'submit',
      state: 'accepted',
      reason: 'invalid_from',
      expectedFrom: ['draft', 'submitted'],
      otherwiseForbidden: undefined,
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toMatchObject({
      blockedBy: 'state',
      reason: 'invalid_from: accepted (expected: draft, submitted)',
    });
  });

  it('ガード式が生成物に無い guard_unsatisfied は原文の代わりに不在を明示する', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'submit',
      state: 'draft',
      reason: 'guard_unsatisfied',
      guardSource: undefined,
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toMatchObject({
      blockedBy: 'guard',
      reason: 'guard_unsatisfied: (guard source unavailable)',
    });
  });

  it('ガード式が生成物に無い guard_unknown は未解決パスだけを診断として返す', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'submit',
      state: 'draft',
      reason: 'guard_unknown',
      guardSource: undefined,
      unresolvedPaths: ['workshop.state'],
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toMatchObject({
      blockedBy: 'guard',
      reason: 'guard_unknown: (guard source unavailable) (unresolved: workshop.state)',
    });
  });

  it('role_forbidden だけは権限なしに写り、実行者のロールを載せる', () => {
    const rejection: FireRejected = {
      allowed: false,
      event: 'accept',
      state: 'submitted',
      reason: 'role_forbidden',
      allowedRoles: ['organizer'],
      actorRoles: ['member'],
    };

    expect(toActionError(rejection, EVENT_ID, ACTOR_ROLE)).toEqual({
      kind: 'forbidden',
      event: EVENT_ID,
      role: ACTOR_ROLE,
    });
  });
});

describe('toCreateActionError', () => {
  it('作成の拒否は状態で塞がれることが無いので常にガードで塞がれた拒否になる', () => {
    const rejection: CreateRejected = {
      allowed: false,
      reason: 'guard_unsatisfied',
      guardSource: 'workshop.state == accepting',
    };

    expect(toCreateActionError(rejection, CREATE_EVENT_ID, ACTOR_ROLE)).toEqual({
      kind: 'guard_unsatisfied',
      event: CREATE_EVENT_ID,
      blockedBy: 'guard',
      reason: 'guard_unsatisfied: workshop.state == accepting',
    });
  });

  it('条件が生成物に無い作成の拒否は原文の代わりに不在を明示する', () => {
    const rejection: CreateRejected = {
      allowed: false,
      reason: 'guard_unsatisfied',
      guardSource: undefined,
    };

    expect(toCreateActionError(rejection, CREATE_EVENT_ID, ACTOR_ROLE)).toMatchObject({
      reason: 'guard_unsatisfied: (guard source unavailable)',
    });
  });

  it('評価できなかった作成の条件は未解決パスつきで返す', () => {
    const rejection: CreateRejected = {
      allowed: false,
      reason: 'guard_unknown',
      guardSource: 'workshop.state == accepting',
      unresolvedPaths: ['workshop.state'],
    };

    expect(toCreateActionError(rejection, CREATE_EVENT_ID, ACTOR_ROLE)).toMatchObject({
      reason: 'guard_unknown: workshop.state == accepting (unresolved: workshop.state)',
    });
  });

  it('作成を許可する規則が1本も無ければ権限なしに写る', () => {
    const rejection: CreateRejected = {
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: ['member'],
      actorRoles: ['anonymous'],
    };

    expect(toCreateActionError(rejection, CREATE_EVENT_ID, 'anonymous')).toEqual({
      kind: 'forbidden',
      event: CREATE_EVENT_ID,
      role: 'anonymous',
    });
  });
});
