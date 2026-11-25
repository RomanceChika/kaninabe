/**
 * 有料の口の共通の入口(`paid-entry.ts`)の**多要素認証の段**のテスト。
 *
 * 画面の関門・生成した Server Action(実行器)・手書きの Server Action は多要素認証を執行するが、cookie で認証する有料の Route Handler は
 * それらを通らない。要求する製品では、多要素認証を済ませていないセッション(パスワードだけが漏れた等)で、枠の消費(meter の RPC)と有料の
 * 外部呼び出しまで届いてはならない。確かめるのは —— ①済ませていないセッションは 403 で、本文を読まず・形も枠も処理も呼ばない
 * ②済ませていれば通る ③範囲が `roles` のとき、口の役に要求するロールが立つ(含意の先を含む)ときだけ止まる ④要求しない製品(外す・IdP に任せる・
 * 認証フロー仕様なし)では何も変わらず、セッションの解決も引かない ⑤解決が無い・投げたときは済ませていないとして止める(安全側)。
 */

import { describe, expect, it } from 'vitest';
import type { MfaRequirement } from '../../domain/bindings';
import type { Logger, LogRecord } from '../../operation/ports';
import { runPaidEntry } from '../paid-entry';
import type { PaidEntryOptions } from '../paid-entry';

const ACTOR = '11111111-1111-4111-8111-111111111111';

/** staff は member を含意する。 */
const ROLE_TABLES = { anonymous: 'guest', authenticated: 'member', system: 'system', implications: { staff: ['member'] } } as const;

/** 呼び出しを記録する部品一式。 */
function harness(mfa: MfaRequirement | undefined, verified: boolean | 'absent' | 'throws', role = 'member') {
  const calls: string[] = [];
  const records: LogRecord[] = [];
  const logger: Logger = { write: (record) => records.push(record) };
  const resolve: Pick<PaidEntryOptions<unknown>, 'resolveMfa'> =
    verified === 'absent'
      ? {}
      : {
          resolveMfa: () => {
            calls.push('resolveMfa');
            return verified === 'throws' ? Promise.reject(new Error('session lookup failed')) : Promise.resolve(verified);
          },
        };
  const options: PaidEntryOptions<unknown> = {
    operation: 'answerSomething',
    maxBodyBytes: 64,
    bindings: { roleTables: ROLE_TABLES, ...(mfa === undefined ? {} : { mfa }) },
    role,
    authorize: () => {
      calls.push('authorize');
      return Promise.resolve({ kind: 'ok', actorId: ACTOR });
    },
    ...resolve,
    parse: (body) => {
      calls.push('parse');
      return { kind: 'ok', value: body };
    },
    consume: () => {
      calls.push('consume');
      return Promise.resolve('used');
    },
    handler: () => {
      calls.push('handler');
      return Promise.resolve(Response.json({ answered: true }));
    },
    logger,
  };
  return { calls, records, options };
}

/** 本文を読んだかを数える要求。 */
function trackedRequest(): { request: Request; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode('{"ok":1}'));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: stream, duplex: 'half' };
  return { request: new Request('http://localhost/api/x', init), pulled: () => pulled };
}

const ALL: MfaRequirement = { scope: 'all' };

describe('runPaidEntry の多要素認証の段', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MFA-008
  it('要求する製品で、多要素認証を済ませていないセッションは 403(mfa_required)で、本文を読まず・形も枠も有料の処理も呼ばれない', async () => {
    for (const mfa of [ALL, { scope: 'roles', roles: ['member'] } as const]) {
      const { calls, records, options } = harness(mfa, false);
      const body = trackedRequest();

      const response = await runPaidEntry(body.request, options);

      expect(response.status, JSON.stringify(mfa)).toBe(403);
      expect(await response.json()).toEqual({ error: 'mfa_required' });
      expect(calls).toEqual(['authorize', 'resolveMfa']);
      expect(body.pulled(), '本文を読んでいない').toBe(0);
      expect(records).toEqual([
        {
          level: 'warn',
          security_event: 'mfa_refused',
          refusal_code: 'mfa_required',
          error_kind: 'forbidden',
          operation: 'answerSomething',
          actor_id: ACTOR,
          request_id: null,
        },
      ]);
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MFA-009
  it('多要素認証を済ませたセッションは従来どおり 認可 → 形 → 枠の消費 → 有料の処理 の順に通る', async () => {
    const { calls, records, options } = harness(ALL, true);

    const response = await runPaidEntry(new Request('http://localhost/api/x', { method: 'POST', body: '{"ok":1}' }), options);

    expect(response.status).toBe(200);
    expect(calls).toEqual(['authorize', 'resolveMfa', 'parse', 'consume', 'handler']);
    expect(records).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MFA-010
  it('要求しない製品(外す宣言・IdP に任せる宣言・認証フロー仕様なし = bindings.mfa が無い)では何も変わらず、セッションの解決も引かない', async () => {
    const { calls, options } = harness(undefined, false);

    const response = await runPaidEntry(new Request('http://localhost/api/x', { method: 'POST', body: '{"ok":1}' }), options);

    expect(response.status).toBe(200);
    expect(calls).toEqual(['authorize', 'parse', 'consume', 'handler']);
  });

  it('範囲が roles のとき、口の役に要求するロールが立つ(含意の先を含む)ときだけ止まり、立たなければ解決も引かず通る', async () => {
    const cases: readonly { readonly roles: readonly string[]; readonly role: string; readonly stops: boolean }[] = [
      { roles: ['member'], role: 'member', stops: true },
      // staff は member を含意するので、member に要求があれば staff の口も止める(狭い側に倒す)。
      { roles: ['member'], role: 'staff', stops: true },
      { roles: ['staff'], role: 'staff', stops: true },
      // member の口に立つのは member だけ。staff への要求は掛からない。
      { roles: ['staff'], role: 'member', stops: false },
      { roles: ['organizer'], role: 'member', stops: false },
    ];
    for (const { roles, role, stops } of cases) {
      const { calls, options } = harness({ scope: 'roles', roles }, false, role);

      const response = await runPaidEntry(new Request('http://localhost/api/x', { method: 'POST', body: '{"ok":1}' }), options);

      expect(response.status, JSON.stringify({ roles, role })).toBe(stops ? 403 : 200);
      expect(calls.includes('resolveMfa'), JSON.stringify({ roles, role })).toBe(stops);
      expect(calls.includes('handler')).toBe(!stops);
    }
  });

  it('要求する製品で、解決を渡さない・解決が投げるときは済ませていないとして止める(安全側。開く側に倒さない)', async () => {
    for (const verified of ['absent', 'throws'] as const) {
      const { calls, options } = harness(ALL, verified);

      const response = await runPaidEntry(new Request('http://localhost/api/x', { method: 'POST', body: '{"ok":1}' }), options);

      expect(response.status, verified).toBe(403);
      expect(calls).not.toContain('consume');
      expect(calls).not.toContain('handler');
    }
  });

  it('未ログイン・役が無いときは多要素認証の前に 401 / 403(段の順序: 認可が先)', async () => {
    const { calls, options } = harness(ALL, false);
    const unauthenticated: PaidEntryOptions<unknown> = { ...options, authorize: () => Promise.resolve({ kind: 'unauthenticated' }) };

    const response = await runPaidEntry(new Request('http://localhost/api/x', { method: 'POST', body: '{}' }), unauthenticated);

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
