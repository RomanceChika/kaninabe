import { describe, expect, it } from 'vitest';
import { CARRY_BODY_LIMIT_BYTES, startOutcome, startSignIn } from '../sign-in';
import { cookieWrite } from '../cookie-policy';
import type { SignInStartConfig } from '../sign-in';
import { FAKE_AUTH_URL } from './fakes/auth-server';

/** サインインの開始の口(`sign-in.ts`)。 */

const CARRY = { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 16, pattern: /^[A-Za-z0-9_-]+$/ } as const;

const CONFIG: SignInStartConfig = {
  endpoint: { url: FAKE_AUTH_URL, anonKey: 'anon' },
  provider: 'discord',
  callbackPath: '/api/auth/callback',
  failurePath: '/login?error=start_failed',
  carry: CARRY,
};

/** 同じオリジンのページからのフォーム送信。 */
function formPost(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/api/auth/sign-in', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', ...headers },
    body: new URLSearchParams(fields),
  });
}

/** Set-Cookie を名前ごとに引く。 */
function setCookies(response: Response): Map<string, string> {
  return new Map(response.headers.getSetCookie().map((value) => [value.split('=')[0] ?? '', value]));
}

describe('サインインの開始の口', () => {
  it('認可の URL へ 303 で送り、検証子と運ぶ値を HttpOnly・Secure・SameSite=Lax の __Host- cookie で返す', async () => {
    const response = await startSignIn(formPost({ code: 'abc123' }), CONFIG);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(`${FAKE_AUTH_URL}/auth/v1/authorize`);
    expect(location.searchParams.get('provider')).toBe('discord');
    expect(location.searchParams.get('redirect_to')).toBe('https://app.example/api/auth/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('s256');
    const cookies = setCookies(response);
    expect(cookies.get('__Host-carry')).toBe('__Host-carry=abc123; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(cookies.get('__Host-auth-code-verifier')).toMatch(/; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    for (const value of cookies.values()) {
      expect(value.startsWith('__Host-')).toBe(true);
      expect(value).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    }
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('運ぶ値が無ければ、古い値の cookie を消す', async () => {
    const response = await startSignIn(formPost({}), CONFIG);
    expect(setCookies(response).get('__Host-carry')).toBe('__Host-carry=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
  });

  it('運ぶ値の宣言が無ければ本文を読まない', async () => {
    const withoutCarry: SignInStartConfig = { endpoint: CONFIG.endpoint, provider: CONFIG.provider, callbackPath: CONFIG.callbackPath, failurePath: CONFIG.failurePath };
    const response = await startSignIn(formPost({ code: 'ignored' }), withoutCarry);
    expect(response.status).toBe(303);
    expect(setCookies(response).has('__Host-carry')).toBe(false);
  });

  it('長すぎる値・フォームとして読めない本文は 400', async () => {
    expect((await startSignIn(formPost({ code: 'x'.repeat(17) }), CONFIG)).status).toBe(400);
    // 宣言の形の外(制御文字・区切り)も 400(点検 19 回目 O19-3)。
    expect((await startSignIn(formPost({ code: 'ab\u0000c' }), CONFIG)).status).toBe(400);
    expect((await startSignIn(formPost({ code: 'ab;c' }), CONFIG)).status).toBe(400);
    const json = new Request('https://app.example/api/auth/sign-in', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', 'content-type': 'application/json' },
      body: '{"code":"abc"}',
    });
    expect((await startSignIn(json, CONFIG)).status).toBe(400);
  });

  it('本文が上限(4KB)を超えれば 413(Content-Length が大きいときは読まず、長さを偽る・省く本文も読みながら打ち切る)。cookie は書かない', async () => {
    const big = 'x'.repeat(CARRY_BODY_LIMIT_BYTES + 1);
    const declared = await startSignIn(formPost({ code: 'abc', pad: big }), CONFIG);
    expect(declared.status).toBe(413);
    expect(declared.headers.getSetCookie()).toEqual([]);
    expect(declared.headers.get('cache-control')).toBe('no-store');
    // Content-Length を持たない(chunked 相当の)流れ。超えた時点で読みを打ち切る。
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          if (pulled > 1000) controller.close();
          else controller.enqueue(new TextEncoder().encode('code=' + 'y'.repeat(1024)));
        },
      },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: stream,
      duplex: 'half',
    };
    const streamed = await startSignIn(new Request('https://app.example/api/auth/sign-in', init), CONFIG);
    expect(streamed.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(6);
    // 上限の中なら従来どおり通る。
    expect((await startSignIn(formPost({ code: 'abc', pad: 'x'.repeat(2000) }), CONFIG)).status).toBe(303);
  });

  it('本文が無い POST・Content-Type の無い本文はフォームとして読めないので 400', async () => {
    const headers = { 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example' };
    const bodiless = new Request('https://app.example/api/auth/sign-in', { method: 'POST', headers });
    expect((await startSignIn(bodiless, CONFIG)).status).toBe(400);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('code=abc'));
        controller.close();
      },
    });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: stream, duplex: 'half' };
    expect((await startSignIn(new Request('https://app.example/api/auth/sign-in', init), CONFIG)).status).toBe(400);
  });

  it('同じオリジンのページから出たと確かめられない要求は 403、状態を変えないメソッドは 405', async () => {
    const crossSite = await startSignIn(formPost({ code: 'abc' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), CONFIG);
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.getSetCookie()).toEqual([]);
    const get = await startSignIn(new Request('https://app.example/api/auth/sign-in'), CONFIG);
    expect(get.status).toBe(405);
  });

  it('運ぶ値の宣言が約束を守っていなければプログラムの誤りとして止める', async () => {
    await expect(startSignIn(formPost({}), { ...CONFIG, carry: { ...CARRY, name: 'carry' } })).rejects.toThrow(/約束を守っていません/);
  });

  it('始めた結果がエラー・空の URL・認証基盤のオリジンでない URL なら、cookie を載せずに失敗の着地(相対パス)へ送る', () => {
    const writes = [cookieWrite('__Host-auth-code-verifier', 'v', {})];
    const failure = '/login?error=start_failed';
    const auth = 'https://auth.example';
    expect(startOutcome({ data: { url: 'https://auth.example/authorize' }, error: null }, writes, failure, auth)).toEqual({ destination: 'https://auth.example/authorize', writes, failed: false });
    const failed = { destination: failure, writes: [], failed: true };
    const rows: readonly (readonly [string | null, unknown])[] = [
      [null, new Error('x')],
      [null, null],
      ['', null],
      ['https://evil.example/authorize', null],
      ['https://auth.example.evil.example/authorize', null],
      ['http://auth.example/authorize', null],
      ['https://auth.example:8443/authorize', null],
      ['https://auth.example@evil.example/', null],
      ['javascript:alert(1)', null],
      ['/relative', null],
      ['not a url', null],
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const [url, error] of rows) expect(startOutcome({ data: { url }, error }, writes, failure, auth), String(url)).toEqual(failed);
  });

  it.each([['https://evil.example/login'], ['//evil.example'], ['/\\evil.example'], ['login'], ['']])('失敗の着地 %s が同じオリジンの相対パスでなければ、口は例外(外へ倒さない・何も書かない)', async (failurePath) => {
    await expect(startSignIn(formPost({}), { ...CONFIG, failurePath })).rejects.toThrow(/failurePath は同じオリジンの相対パス/u);
  });
});
