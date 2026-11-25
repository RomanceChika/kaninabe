import { retryRollbacks } from '@kaninabe/adapter-postgrest';
import type { PostgrestErrorLike, RpcResponse } from '@kaninabe/adapter-postgrest';
import { describe, expect, it } from 'vitest';
import { SESSION_RPC_NAMES, SessionAdminError, createSessionAdmin, currentSessionIdOf } from '../session-admin';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** 呼ばれた RPC を記録し、決まった結果を返す口(やり直しの口 `retryRollbacks` を通した、型の印つきの口として渡す)。 */
function fakeRpc(result: { data?: unknown; error?: PostgrestErrorLike | null; throws?: unknown } = {}) {
  const calls: { fn: string; args: Readonly<Record<string, unknown>> }[] = [];
  const raw = {
    rpc: (fn: string, args: Readonly<Record<string, unknown>>): Promise<RpcResponse> => {
      calls.push({ fn, args });
      if (result.throws !== undefined) return Promise.reject(result.throws as Error);
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  return { client: retryRollbacks(raw), calls };
}

const ROW = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: '2026-10-23T00:00:00+00:00',
  last_active_at: '2026-10-23T01:00:00+00:00',
  user_agent: 'Mozilla/5.0',
  ip: '203.0.113.7',
  ...extra,
});

describe('セッションの一覧', () => {
  it('RPC にメンバー ID だけを渡し、必要な欄だけを要約にして返す(トークンの類は RPC が返しても通さない)', async () => {
    const { client, calls } = fakeRpc({ data: [ROW(SESSION_A, { refresh_token: 'secret', access_token: 'secret2', refresh_token_hmac_key: 'k' }), ROW(SESSION_B)] });
    const list = await createSessionAdmin(client).list(MEMBER, SESSION_B);
    expect(calls).toEqual([{ fn: SESSION_RPC_NAMES.list, args: { p_member_id: MEMBER } }]);
    expect(list).toEqual([
      { id: SESSION_A, createdAt: '2026-10-23T00:00:00+00:00', lastActiveAt: '2026-10-23T01:00:00+00:00', userAgent: 'Mozilla/5.0', ip: '203.0.113.7', current: false },
      { id: SESSION_B, createdAt: '2026-10-23T00:00:00+00:00', lastActiveAt: '2026-10-23T01:00:00+00:00', userAgent: 'Mozilla/5.0', ip: '203.0.113.7', current: true },
    ]);
    expect(JSON.stringify(list)).not.toContain('secret');
    expect(JSON.stringify(list)).not.toContain('hmac');
  });

  it('User-Agent・IP が保存されていなければ null。いまの端末が分からなければ誰にも「ここ」の印を付けない', async () => {
    const { client } = fakeRpc({ data: [ROW(SESSION_A, { user_agent: null, ip: null })] });
    const [only] = await createSessionAdmin(client).list(MEMBER, null);
    expect(only).toMatchObject({ userAgent: null, ip: null, current: false });
  });

  it('「ここ」の比較は大文字小文字を問わない', async () => {
    const { client } = fakeRpc({ data: [ROW(SESSION_A)] });
    const [only] = await createSessionAdmin(client).list(MEMBER, SESSION_A.toUpperCase());
    expect(only?.current).toBe(true);
  });

  it('空の一覧は空で返す', async () => {
    await expect(createSessionAdmin(fakeRpc({ data: [] }).client).list(MEMBER, null)).resolves.toEqual([]);
  });

  it.each([
    ['配列でない', { rows: [] }],
    ['行がオブジェクトでない', ['x']],
    ['id が無い', [{ created_at: 'a', last_active_at: 'b', user_agent: null, ip: null }]],
    ['時刻が文字列でない', [ROW(SESSION_A, { created_at: 1 })]],
    ['User-Agent が文字列でも null でもない', [ROW(SESSION_A, { user_agent: 5 })]],
    ['IP が欠けている(undefined)', [{ id: SESSION_A, created_at: 'a', last_active_at: 'b', user_agent: null }]],
  ])('RPC の戻り値の形が崩れていたら失敗(%s)', async (_label, data) => {
    await expect(createSessionAdmin(fakeRpc({ data }).client).list(MEMBER, null)).rejects.toBeInstanceOf(SessionAdminError);
  });
});

describe('セッションを終える操作', () => {
  it('1 本終える: 終えたら true・別のメンバーのセッション(0 件)なら false', async () => {
    const hit = fakeRpc({ data: 1 });
    await expect(createSessionAdmin(hit.client).end(MEMBER, SESSION_A)).resolves.toBe(true);
    expect(hit.calls).toEqual([{ fn: SESSION_RPC_NAMES.end, args: { p_member_id: MEMBER, p_session_id: SESSION_A } }]);
    await expect(createSessionAdmin(fakeRpc({ data: 0 }).client).end(MEMBER, SESSION_B)).resolves.toBe(false);
  });

  it('自分以外を終える: 残す 1 本とメンバーを渡し、終えた本数を返す', async () => {
    const { client, calls } = fakeRpc({ data: 3 });
    await expect(createSessionAdmin(client).endOthers(MEMBER, SESSION_A)).resolves.toBe(3);
    expect(calls).toEqual([{ fn: SESSION_RPC_NAMES.endOthers, args: { p_member_id: MEMBER, p_keep_session_id: SESSION_A } }]);
  });

  it('メンバーの全部を終える(退会・無効化の遷移の RPC が呼ぶ関数と同じ)', async () => {
    const { client, calls } = fakeRpc({ data: 2 });
    await expect(createSessionAdmin(client).endAll(OTHER)).resolves.toBe(2);
    expect(calls).toEqual([{ fn: 'revoke_auth_sessions', args: { p_member_id: OTHER } }]);
  });

  it('全員を終える: 除外するメンバーを 1 人まで(null なら全員)', async () => {
    const some = fakeRpc({ data: 9 });
    await expect(createSessionAdmin(some.client).endEvery(MEMBER)).resolves.toBe(9);
    expect(some.calls).toEqual([{ fn: SESSION_RPC_NAMES.endEvery, args: { p_except_member_id: MEMBER } }]);
    const everyone = fakeRpc({ data: 10 });
    await createSessionAdmin(everyone.client).endEvery(null);
    expect(everyone.calls[0]?.args).toEqual({ p_except_member_id: null });
  });

  it('RPC の名前は製品が差し替えられる', async () => {
    const { client, calls } = fakeRpc({ data: 0 });
    await createSessionAdmin(client, { ...SESSION_RPC_NAMES, endAllOf: 'my_end_all' }).endAll(MEMBER);
    expect(calls[0]?.fn).toBe('my_end_all');
  });

  it.each([
    ['end', (a: ReturnType<typeof createSessionAdmin>) => a.end('not-a-uuid', SESSION_A)],
    ['end', (a: ReturnType<typeof createSessionAdmin>) => a.end(MEMBER, "x'; drop table")],
    ['endOthers', (a: ReturnType<typeof createSessionAdmin>) => a.endOthers(MEMBER, '')],
    ['endAll', (a: ReturnType<typeof createSessionAdmin>) => a.endAll('1')],
    ['endEvery', (a: ReturnType<typeof createSessionAdmin>) => a.endEvery('nope')],
    ['list', (a: ReturnType<typeof createSessionAdmin>) => a.list('nope', null)],
  ])('ID が UUID の形でなければ RPC を呼ぶ前に落とす(%s)', async (operation, run) => {
    const { client, calls } = fakeRpc({ data: 1 });
    await expect(run(createSessionAdmin(client))).rejects.toMatchObject({ name: 'SessionAdminError', operation });
    expect(calls).toEqual([]);
  });

  it.each([['文字列', 'x'], ['負数', -1], ['小数', 1.5], ['null', null]])('戻り値が件数でなければ失敗(%s)', async (_label, data) => {
    await expect(createSessionAdmin(fakeRpc({ data }).client).endAll(MEMBER)).rejects.toBeInstanceOf(SessionAdminError);
  });

  it('認証基盤が失敗を返しても・届かなくても SessionAdminError に揃え、応答の中身はメッセージに載せない', async () => {
    const failed = createSessionAdmin(fakeRpc({ error: { code: 'P0001', message: 'secret-detail', details: null, hint: null } }).client);
    const error: unknown = await failed.endAll(MEMBER).catch((e: unknown) => e);
    if (!(error instanceof SessionAdminError)) throw new Error('SessionAdminError が投げられていません');
    expect(error.operation).toBe('endAll');
    expect(error.message).not.toContain('secret-detail');
    await expect(createSessionAdmin(fakeRpc({ throws: new Error('network') }).client).end(MEMBER, SESSION_A)).rejects.toMatchObject({ operation: 'end' });
  });
});

describe('いまのセッションの ID', () => {
  it('署名を確かめたクレームの session_id(UUID)を返す', async () => {
    const client = { auth: { getClaims: () => Promise.resolve({ data: { claims: { session_id: SESSION_A } }, error: null }) } };
    await expect(currentSessionIdOf(client)).resolves.toBe(SESSION_A);
  });

  it.each([
    ['クレームが無い(未ログイン)', { data: null, error: null }],
    ['session_id が無い', { data: { claims: {} }, error: null }],
    ['UUID でない', { data: { claims: { session_id: 'x' } }, error: null }],
    ['数', { data: { claims: { session_id: 5 } }, error: null }],
    ['エラーつき', { data: { claims: { session_id: SESSION_A } }, error: new Error('bad') }],
  ])('読めなければ null(%s)', async (_label, result) => {
    await expect(currentSessionIdOf({ auth: { getClaims: () => Promise.resolve(result) } })).resolves.toBeNull();
  });

  it('問い合わせが例外を投げても null', async () => {
    await expect(currentSessionIdOf({ auth: { getClaims: () => Promise.reject(new Error('boom')) } })).resolves.toBeNull();
  });
});
