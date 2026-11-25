/**
 * セキュリティログ(`security-log.ts` / `security-events.ts`)のユニットテスト。
 *
 * 確かめるのは 5 つ —— ①拒否の分類ごとに、同じ形の行が出る(`toEqual` の全体一致。表で回す) ②成功は出さない
 * ③入力値・理由文・ロール ID・トークンの類が行に載らない ④認証の事象の重大度は目録が決める ⑤要求の識別子の読み方と、出どころの拒否の行。
 * 目録(`SECURITY_EVENTS`)が `LogRecord` の語彙と食い違わないことも固定する。
 */

import { describe, expect, it } from 'vitest';
import type { ActionError } from '../../domain/result';
import { err, ok } from '../../domain/result';
import type { Logger, LogRecord } from '../ports';
import {
  LOG_FIELD_NAMES,
  SECURITY_EVENTS,
  originRefusalRecord,
  recordAuthEvent,
  recordRefusal,
  refusalRecord,
  requestIdOf,
  stdoutLogger,
} from '../security-log';
import type { AuthEventId } from '../security-log';

const ACTOR = '22222222-2222-4222-8222-222222222222';
const CONTEXT = { operation: 'settleWidget', actorId: ACTOR, requestId: 'iad1::abcde-1234' } as const;

/** 出した行を貯める口。 */
function fakeLogger(): Logger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, write: (record) => void records.push(record) };
}

/** 拒否の分類ごとの期待(表)。 */
const REFUSAL_CASES: readonly { readonly name: string; readonly error: ActionError; readonly expected: LogRecord }[] = [
  {
    name: '権限の拒否(forbidden)',
    error: { kind: 'forbidden', event: 'widget.settle', role: 'member' },
    expected: {
      level: 'warn',
      security_event: 'authz_refused',
      operation: 'settleWidget',
      event: 'widget.settle',
      actor_id: ACTOR,
      error_kind: 'forbidden',
      refusal_code: 'role_forbidden',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '多要素認証の拒否(forbidden + mfaRequired)',
    error: { kind: 'forbidden', event: 'widget.settle', role: 'staff', mfaRequired: true },
    expected: {
      level: 'warn',
      security_event: 'mfa_refused',
      operation: 'settleWidget',
      event: 'widget.settle',
      actor_id: ACTOR,
      error_kind: 'forbidden',
      refusal_code: 'mfa_required',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '入力の検証の失敗(invalid_input。event を付けない)',
    error: { kind: 'invalid_input', issues: [{ field: 'title', code: 'too_big' }] },
    expected: {
      level: 'warn',
      security_event: 'input_rejected',
      operation: 'settleWidget',
      actor_id: ACTOR,
      error_kind: 'invalid_input',
      refusal_code: 'invalid_input',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '状態の拒否(guard_unsatisfied / state)',
    error: { kind: 'guard_unsatisfied', event: 'widget.settle', blockedBy: 'state', reason: 'invalid_from: closed' },
    expected: {
      level: 'warn',
      security_event: 'rule_refused',
      operation: 'settleWidget',
      event: 'widget.settle',
      actor_id: ACTOR,
      error_kind: 'guard_unsatisfied',
      refusal_code: 'state_conflict',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: 'ガードの拒否(guard_unsatisfied / guard)',
    error: { kind: 'guard_unsatisfied', event: 'widget.settle', blockedBy: 'guard', reason: 'guard_unsatisfied: now < deadline' },
    expected: {
      level: 'warn',
      security_event: 'rule_refused',
      operation: 'settleWidget',
      event: 'widget.settle',
      actor_id: ACTOR,
      error_kind: 'guard_unsatisfied',
      refusal_code: 'guard_unsatisfied',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '不変条件の拒否(invariant_violated。流量の天井もここに来る)',
    error: { kind: 'invariant_violated', invariant: 'INV-INQUIRY-001' },
    expected: {
      level: 'warn',
      security_event: 'invariant_refused',
      operation: 'settleWidget',
      actor_id: ACTOR,
      error_kind: 'invariant_violated',
      refusal_code: 'invariant_violated',
      invariant: 'INV-INQUIRY-001',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '例外で終わった Action(temporarily_unavailable。点検 19 回目 O19-2。event も文言も載らない)',
    error: { kind: 'temporarily_unavailable' },
    expected: {
      level: 'warn',
      security_event: 'action_failed',
      operation: 'settleWidget',
      actor_id: ACTOR,
      error_kind: 'temporarily_unavailable',
      refusal_code: 'action_threw',
      commit: 'unknown',
      request_id: 'iad1::abcde-1234',
    },
  },
  {
    name: '届く前に落ちた一時的な失敗(点検 21 回目 B の O21-1。書けたかどうかが行に載る)',
    error: { kind: 'temporarily_unavailable', commit: 'not_committed' },
    expected: {
      level: 'warn',
      security_event: 'action_failed',
      operation: 'settleWidget',
      actor_id: ACTOR,
      error_kind: 'temporarily_unavailable',
      refusal_code: 'action_threw',
      commit: 'not_committed',
      request_id: 'iad1::abcde-1234',
    },
  },
];

describe('refusalRecord / recordRefusal(拒否の分類ごとの行)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SECLOG-001
  it('拒否の分類(権限・多要素認証・入力・状態・ガード・不変条件)ごとに、閉じた欄だけの 1 行が出る', () => {
    expect(REFUSAL_CASES).toHaveLength(8);
    for (const testCase of REFUSAL_CASES) {
      const logger = fakeLogger();

      recordRefusal(logger, CONTEXT, err(testCase.error));

      expect(logger.records, testCase.name).toEqual([testCase.expected]);
      expect(refusalRecord(CONTEXT, testCase.error), testCase.name).toEqual(testCase.expected);
    }
  });

  it('未ログイン(actorId が null)の拒否は actor_id: null で出る', () => {
    const logger = fakeLogger();

    recordRefusal(logger, { ...CONTEXT, actorId: null, requestId: null }, err({ kind: 'forbidden', event: 'widget.settle', role: 'anonymous' }));

    expect(logger.records[0]).toMatchObject({ actor_id: null, request_id: null, security_event: 'authz_refused' });
  });

  it('成功は出さない', () => {
    const logger = fakeLogger();

    recordRefusal(logger, CONTEXT, ok({ id: 'x', state: 'closed' }));

    expect(logger.records).toEqual([]);
  });

  it('どの分類の行も、目録に載った事象と LogRecord の欄だけを持つ', () => {
    const events = new Set<string>(SECURITY_EVENTS.map((entry) => entry.id));
    const fields = new Set<string>(LOG_FIELD_NAMES);
    for (const testCase of REFUSAL_CASES) {
      const record = refusalRecord(CONTEXT, testCase.error);
      expect(events.has(record.security_event ?? '')).toBe(true);
      for (const key of Object.keys(record)) expect(fields.has(key)).toBe(true);
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-SECLOG-002
  it('入力値・理由文・ロール ID・指摘のフィールド名は行に載らない', () => {
    const secrets: readonly ActionError[] = [
      { kind: 'invalid_input', issues: [{ field: 'email_secret_field', code: 'invalid_format' }] },
      { kind: 'guard_unsatisfied', event: 'widget.settle', blockedBy: 'guard', reason: 'guard_unsatisfied: member.email == "leak@example.com"' },
      { kind: 'forbidden', event: 'widget.settle', role: 'role_secret_name' },
    ];
    expect(secrets).not.toHaveLength(0);
    for (const error of secrets) {
      const line = JSON.stringify(refusalRecord(CONTEXT, error));
      for (const leak of ['email_secret_field', 'leak@example.com', 'guard_unsatisfied: member', 'role_secret_name']) {
        expect(line).not.toContain(leak);
      }
    }
  });
});

describe('recordAuthEvent(認証の事象)', () => {
  const CASES: readonly { readonly event: AuthEventId; readonly level: 'info' | 'warn' }[] = [
    { event: 'sign_in_started', level: 'info' },
    { event: 'sign_in_start_failed', level: 'warn' },
    { event: 'sign_in_callback_succeeded', level: 'info' },
    { event: 'sign_in_callback_failed', level: 'warn' },
    { event: 'signed_out', level: 'info' },
    { event: 'sign_out_degraded', level: 'warn' },
    { event: 'sessions_ended', level: 'info' },
  ];

  // @spec framework-guarantee-catalog @tc TC-FW-SECLOG-003
  it('認証の事象は、目録の重大度で、事象・実行者・結末・要求の識別子だけが出る', () => {
    expect(CASES).toHaveLength(7);
    for (const { event, level } of CASES) {
      const logger = fakeLogger();

      recordAuthEvent(logger, { event, actorId: ACTOR, decision: 'active', requestId: 'req-1' });

      expect(logger.records, event).toEqual([{ level, security_event: event, actor_id: ACTOR, decision: 'active', request_id: 'req-1' }]);
    }
  });

  it('目録の認証の事象は、このテストの表と過不足なく一致する(事象を足したら表にも足す)', () => {
    const listed = SECURITY_EVENTS.filter((entry) => entry.source === 'auth_route').map((entry) => entry.id);
    expect([...listed].sort()).toEqual(CASES.map((entry) => entry.event).sort());
  });

  it('目録の重大度と、記録の重大度が一致する', () => {
    for (const entry of SECURITY_EVENTS.filter((spec) => spec.source === 'auth_route')) {
      const logger = fakeLogger();
      recordAuthEvent(logger, { event: entry.id as AuthEventId, actorId: null, decision: 'x', requestId: null });
      expect(logger.records[0]?.level).toBe(entry.level);
    }
  });
});

describe('originRefusalRecord / requestIdOf', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SECLOG-004
  it('出どころの拒否は、事象・分類・要求の識別子だけを持つ(経路は載せない)', () => {
    expect(originRefusalRecord('req-9')).toEqual({ level: 'warn', security_event: 'origin_refused', refusal_code: 'cross_origin', request_id: 'req-9' });
    expect(originRefusalRecord(null)).toEqual({ level: 'warn', security_event: 'origin_refused', refusal_code: 'cross_origin', request_id: null });
  });

  it('配置先の x-vercel-id を先に、無ければ x-request-id を読む(利用者が送れる x-request-id で上書きされない)', () => {
    expect(requestIdOf(new Headers({ 'x-request-id': 'forged-0001', 'x-vercel-id': 'iad1::x' }))).toBe('iad1::x');
    expect(requestIdOf(new Headers({ 'x-vercel-id': 'iad1::x-9' }))).toBe('iad1::x-9');
    expect(requestIdOf(new Headers({ 'x-request-id': 'abc-1' }))).toBe('abc-1');
    expect(requestIdOf(new Headers())).toBeNull();
  });

  it('形が合わない値(空・長すぎる・制御文字や改行・引用符)は読まない(行の偽造を防ぐ)', () => {
    for (const bad of ['', 'a'.repeat(129), 'a b', 'a"b', 'a,b', 'x\u0000y', 'é']) {
      expect(requestIdOf({ get: (name) => (name === 'x-vercel-id' || name === 'x-request-id' ? bad : null) })).toBeNull();
    }
  });

  it('形が合わない x-vercel-id は読み飛ばして、x-request-id を見る', () => {
    expect(requestIdOf({ get: (name) => (name === 'x-vercel-id' ? 'bad value' : name === 'x-request-id' ? 'req-ok' : null) })).toBe('req-ok');
  });
});

describe('stdoutLogger / 目録', () => {
  it('標準出力に 1 行 1 JSON で出す', () => {
    const lines: unknown[] = [];
    const original = console.info;
    console.info = (line: unknown) => void lines.push(line);
    try {
      stdoutLogger.write({ level: 'warn', security_event: 'origin_refused' });
    } finally {
      console.info = original;
    }
    expect(lines).toEqual(['{"level":"warn","security_event":"origin_refused"}']);
  });

  it('事象の ID は重複しない・分類の欄が宣言どおり(codes があるなら codeField がある)', () => {
    const ids = SECURITY_EVENTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SECURITY_EVENTS) {
      if (entry.codes.length > 0) expect(entry.codeField).not.toBeNull();
    }
  });

  it('Server Action の拒否の事象は、表(REFUSAL_CASES)が出す事象と過不足なく一致する', () => {
    const declared = SECURITY_EVENTS.filter((entry) => entry.source === 'server_action').map((entry) => entry.id);
    const produced = REFUSAL_CASES.map((entry) => refusalRecord(CONTEXT, entry.error).security_event);
    expect([...new Set(produced)].sort()).toEqual([...declared].sort());
  });
});
