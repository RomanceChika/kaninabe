import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME } from '../cookie-policy';
import type { CookieWrite } from '../cookie-policy';
import { createRefreshBudget } from '../refresh-guard';
import {
  ACCESS_TOKEN_SKEW_MS,
  admitWrites,
  adoptRequestSession,
  createSessionScope,
  isFresh,
  recordHead,
  sessionCookieValueOf,
  snapshotOf,
  snapshotOfCookieValue,
} from '../session-scope';
import type { SessionScope, SessionSnapshot } from '../session-scope';

/**
 * 段の台帳(`session-scope.ts`): セッションの読み・世代の記録・cookie の書き込みの世代の比べ。表で境界を網羅する。
 */

afterEach(() => {
  vi.useRealTimers();
});

/** 文字列を UTF-8 の base64url にする。 */
function base64url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** セッションの JSON。 */
function sessionJson(refreshToken: string, expiresAtSeconds = 2_000_000_000): string {
  return JSON.stringify({ access_token: `at-${refreshToken}`, refresh_token: refreshToken, expires_at: expiresAtSeconds, expires_in: 3600, token_type: 'bearer' });
}

/** セッションの cookie の値(`base64-` の形)。 */
function cookieOf(refreshToken: string): string {
  return `base64-${base64url(sessionJson(refreshToken))}`;
}

/** セッション。 */
function snapshot(refreshToken: string, expiresAtMs = 2_000_000_000_000): SessionSnapshot {
  return { body: sessionJson(refreshToken, expiresAtMs / 1000), refreshToken, expiresAtMs };
}

/** 書き込み 1 本。 */
function write(name: string, value: string, maxAge?: number): CookieWrite {
  return { name, value, options: { ...AUTH_COOKIE_ATTRIBUTES, ...(maxAge === undefined ? {} : { maxAge }) } };
}

describe('createSessionScope', () => {
  it('既定は前段・新しい予算・世代 0', () => {
    const scope = createSessionScope();
    expect(scope).toMatchObject({ stage: 'front', head: null, issued: 0, written: 0 });
    expect(scope.budget).toEqual(createRefreshBudget());
    expect(scope.generations.size).toBe(0);
    expect(scope.pending.size).toBe(0);
  });

  it('段と予算を渡せる(予算は同じものを分ける)', () => {
    const budget = createRefreshBudget(true);
    const scope = createSessionScope({ stage: 'downstream', budget });
    expect(scope.stage).toBe('downstream');
    expect(scope.budget).toBe(budget);
  });
});

describe('isFresh(本当に生きているか。余裕は 1 秒)', () => {
  it.each([
    ['余裕より 1ms 長い', ACCESS_TOKEN_SKEW_MS + 1, true],
    ['ちょうど余裕', ACCESS_TOKEN_SKEW_MS, false],
    ['余裕より短い', ACCESS_TOKEN_SKEW_MS - 1, false],
    ['切れている', -1, false],
  ])('%s → %s', (_name, remaining, expected) => {
    expect(isFresh(snapshot('r', 10_000 + remaining), 10_000)).toBe(expected);
  });

  it('いまの既定は Date.now()', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(50_000);
    expect(isFresh(snapshot('r', 50_000 + ACCESS_TOKEN_SKEW_MS + 1))).toBe(true);
    expect(isFresh(snapshot('r', 50_000 + ACCESS_TOKEN_SKEW_MS))).toBe(false);
  });
});

describe('snapshotOf(答えの本文をセッションとして読む)', () => {
  it.each([
    ['正しい形', sessionJson('r1', 100), { refreshToken: 'r1', expiresAtMs: 100_000 }],
    ['JSON でない', '<html>', null],
    ['null', 'null', null],
    ['数', '1', null],
    ['更新トークンが空', JSON.stringify({ access_token: 'a', refresh_token: '', expires_at: 1 }), null],
    ['更新トークンが数', JSON.stringify({ access_token: 'a', refresh_token: 1, expires_at: 1 }), null],
    ['アクセストークンが無い', JSON.stringify({ refresh_token: 'r', expires_at: 1 }), null],
    ['期限が文字列', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: '1' }), null],
  ])('%s', (_name, body, expected) => {
    const read = snapshotOf(body);
    if (expected === null) expect(read).toBeNull();
    else expect(read).toEqual({ body, ...expected });
  });
});

describe('sessionCookieValueOf(本体・分割をつなぐ)', () => {
  it.each([
    ['本体だけ', [{ name: SESSION_COOKIE_NAME, value: 'whole' }], 'whole'],
    ['本体が分割より優先', [{ name: `${SESSION_COOKIE_NAME}.0`, value: 'a' }, { name: SESSION_COOKIE_NAME, value: 'whole' }], 'whole'],
    ['分割を番号順に(並びは問わない)', [{ name: `${SESSION_COOKIE_NAME}.1`, value: 'b' }, { name: `${SESSION_COOKIE_NAME}.0`, value: 'a' }], 'ab'],
    ['欠けた番号の先は使わない', [{ name: `${SESSION_COOKIE_NAME}.0`, value: 'a' }, { name: `${SESSION_COOKIE_NAME}.2`, value: 'c' }], 'a'],
    ['.0 が無ければ無い', [{ name: `${SESSION_COOKIE_NAME}.1`, value: 'b' }], null],
    ['空の値は無いもの', [{ name: SESSION_COOKIE_NAME, value: '' }], null],
    ['検証子は含めない', [{ name: `${SESSION_COOKIE_NAME}-code-verifier`, value: 'v' }], null],
    ['別の名前の分割は含めない', [{ name: 'other.0', value: 'x' }], null],
    ['先頭 0 の番号は分割ではない', [{ name: `${SESSION_COOKIE_NAME}.00`, value: 'x' }], null],
    ['何も無い', [], null],
  ])('%s', (_name, cookies, expected) => {
    expect(sessionCookieValueOf(cookies)).toBe(expected);
  });
});

describe('snapshotOfCookieValue(cookie の値をセッションとして読む)', () => {
  it.each([
    ['base64- の形', cookieOf('r9'), 'r9'],
    ['null', null, null],
    ['接頭辞が無い', sessionJson('r9'), null],
    ['base64 でない', 'base64-%%%', null],
    ['中身が JSON でない', `base64-${base64url('<html>')}`, null],
  ])('%s', (_name, value, expected) => {
    expect(snapshotOfCookieValue(value)?.refreshToken ?? null).toBe(expected);
  });
});

describe('recordHead / adoptRequestSession(世代の記録)', () => {
  it('受け取った順に世代を振り、出したトークンは世代 0 で載せる', () => {
    const scope = createSessionScope();
    recordHead(scope, 'r0', snapshot('r1'));
    recordHead(scope, 'r1', snapshot('r2'));
    expect([...scope.generations]).toEqual([
      ['r0', 0],
      ['r1', 1],
      ['r2', 2],
    ]);
    expect(scope.head?.generation).toBe(2);
    expect(scope.head?.snapshot.refreshToken).toBe('r2');
  });

  it('同じか古い世代の答え(認証基盤が生きている子を返した)は先頭を戻さない', () => {
    const scope = createSessionScope();
    recordHead(scope, 'r0', snapshot('r1'));
    recordHead(scope, 'r1', snapshot('r2'));
    recordHead(scope, 'r0', snapshot('r1'));
    recordHead(scope, 'r1', snapshot('r2'));
    expect(scope.head?.snapshot.refreshToken).toBe('r2');
    expect(scope.issued).toBe(2);
  });

  it('知っているが先頭より新しい世代(書き込みで先に知った)なら先頭にする', () => {
    const scope = createSessionScope();
    admitWrites(scope, [write(SESSION_COOKIE_NAME, cookieOf('r5'))]);
    recordHead(scope, 'r0', snapshot('r5'));
    expect(scope.head?.snapshot.refreshToken).toBe('r5');
  });

  it('要求の cookie を採ると世代 0 の先頭になる(更新していない)', () => {
    const scope = createSessionScope({ stage: 'downstream' });
    adoptRequestSession(scope, snapshot('r0'));
    expect(scope.head).toEqual({ snapshot: snapshot('r0'), generation: 0 });
    expect(scope.generations.get('r0')).toBe(0);
    expect(scope.issued).toBe(0);
  });
});

describe('admitWrites(新しい世代だけが勝つ)', () => {
  /** 世代 r1(1)・r2(2)を知っている台帳。 */
  function known(): SessionScope {
    const scope = createSessionScope();
    recordHead(scope, 'r0', snapshot('r1'));
    recordHead(scope, 'r1', snapshot('r2'));
    return scope;
  }

  it.each([
    ['新しい世代(r2)は通る', ['r2'], [true]],
    ['同じ世代を 2 回: 2 回目は捨てる', ['r2', 'r2'], [true, false]],
    ['新しい世代のあとの古い世代(r1)は捨てる(遅れて着いた書き込み)', ['r2', 'r1'], [true, false]],
    ['古い世代から新しい世代へは通る', ['r1', 'r2'], [true, true]],
    ['要求の cookie(世代 0)の書き戻しは捨てる', ['r0'], [false]],
    ['知らないトークン(サインインの交換)は新しい世代として通る', ['x9'], [true]],
    ['知らないトークンのあとの既知の古い世代は捨てる', ['x9', 'r2'], [true, false]],
  ])('%s', (_name, tokens, expected) => {
    const scope = known();
    const admitted = tokens.map((token) => admitWrites(scope, [write(SESSION_COOKIE_NAME, cookieOf(token))]).length === 1);
    expect(admitted).toEqual(expected);
  });

  it('捨てるのはセッションの系列の分だけ(検証子・移行前の名前の消去は通す)', () => {
    const scope = known();
    admitWrites(scope, [write(SESSION_COOKIE_NAME, cookieOf('r2'))]);
    const others = [write(`${SESSION_COOKIE_NAME}-code-verifier`, 'v'), write('sb-127-auth-token', '', 0)];
    expect(admitWrites(scope, [write(SESSION_COOKIE_NAME, cookieOf('r1')), write(`${SESSION_COOKIE_NAME}.0`, '', 0), ...others])).toEqual(others);
  });

  it('分割の束は、つないだ値の世代で比べる(分割の消去も束で一緒に捨てる)', () => {
    const scope = known();
    const value = cookieOf('r2');
    const chunks = [write(`${SESSION_COOKIE_NAME}.0`, value.slice(0, 10)), write(`${SESSION_COOKIE_NAME}.1`, value.slice(10)), write(SESSION_COOKIE_NAME, '', 0)];
    expect(admitWrites(scope, chunks)).toEqual(chunks);
    expect(scope.written).toBe(2);
    expect(admitWrites(scope, chunks)).toEqual([]);
  });

  it.each([
    ['消去だけの束(認証基盤がセッションの死を言い切った)', [write(SESSION_COOKIE_NAME, '', 0)]],
    ['セッションを含まない束', [write(`${SESSION_COOKIE_NAME}-code-verifier`, 'v')]],
    ['読めない値の束', [write(SESSION_COOKIE_NAME, 'not-a-session')]],
  ])('%s はそのまま通し、世代を動かさない', (_name, writes) => {
    const scope = known();
    admitWrites(scope, [write(SESSION_COOKIE_NAME, cookieOf('r2'))]);
    expect(admitWrites(scope, writes)).toEqual(writes);
    expect(scope.written).toBe(2);
  });
});
