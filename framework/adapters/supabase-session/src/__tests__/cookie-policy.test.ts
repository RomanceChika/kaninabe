import { describe, expect, it } from 'vitest';
import {
  AUTH_COOKIE_ATTRIBUTES,
  SESSION_COOKIE_NAME,
  VERIFIER_MAX_AGE_SECONDS,
  assertCarrySpec,
  carriedValue,
  cookieWrite,
  expiredCookie,
  hardenedOptions,
  isLegacySessionCookieName,
  isSessionCookieName,
} from '../cookie-policy';

/**
 * 認証の cookie の約束(`cookie-policy.ts`)。**ライブラリが何を渡してきても、書く属性は約束の値になる**ことを見る。
 */
describe('認証の cookie の約束', () => {
  it('約束の属性は HttpOnly・Secure・SameSite=Lax・Path=/ で、名前は __Host- で始まる', () => {
    expect(AUTH_COOKIE_ATTRIBUTES).toEqual({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    expect(SESSION_COOKIE_NAME).toBe('__Host-auth');
  });

  it('ライブラリが緩い属性を渡しても、寿命だけを拾って約束の値で上書きする', () => {
    const loose = { maxAge: 34560000, httpOnly: false, secure: false, sameSite: 'none', domain: 'example.com', path: '/x' } as const;
    expect(hardenedOptions(loose)).toEqual({ path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 34560000 });
    const expires = new Date('2026-10-21T00:00:00Z');
    expect(hardenedOptions({ expires })).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, expires });
    expect(hardenedOptions({})).toEqual(AUTH_COOKIE_ATTRIBUTES);
  });

  it('__Host- で始まらない名前の書き込みはプログラムの誤りとして止める', () => {
    expect(() => cookieWrite('sb-127-auth-token', 'x', {})).toThrow(/__Host-/);
    expect(cookieWrite('__Host-auth', 'v', { maxAge: 10 })).toEqual({ name: '__Host-auth', value: 'v', options: { ...AUTH_COOKIE_ATTRIBUTES, maxAge: 10 } });
  });

  it('PKCE の検証子は寿命を 10 分までに縮める(期限の日時は落とす)。セッション・消去・短い寿命はそのまま', () => {
    expect(VERIFIER_MAX_AGE_SECONDS).toBe(600);
    for (const name of ['__Host-auth-code-verifier', '__Host-auth-flows-code-verifier', '__Host-auth-flow-abcdef12-code-verifier']) {
      expect(cookieWrite(name, 'v', { maxAge: 34560000, expires: new Date('2027-01-01T00:00:00Z') }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 600 });
    }
    expect(cookieWrite('__Host-auth-code-verifier', 'v', {}).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 600 });
    expect(cookieWrite('__Host-auth-code-verifier', 'v', { maxAge: 60 }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 60 });
    expect(cookieWrite('__Host-auth-code-verifier', '', { maxAge: 0 }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 });
    expect(cookieWrite('__Host-auth-code-verifier', 'v', { maxAge: 0 }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 });
    expect(cookieWrite('__Host-auth.0', 'v', { maxAge: 34560000 }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 34560000 });
  });

  it('分割された検証子(`….code-verifier.0` `.1` …)も系列として見て 10 分に縮める。分割に似た別の名前は検証子と数えない', () => {
    // 0.12.7 の @supabase/ssr では検証子の値が分割の閾値(3180)に届かないので実際には分かれないが、版が上がって値が伸びたときに
    // 分割の 1 本だけがライブラリの寿命(400 日)のまま残る形を、名前の判定の側で塞ぐ。
    const split = ['__Host-auth-code-verifier.0', '__Host-auth-code-verifier.1', '__Host-auth-code-verifier.12', '__Host-auth-flows-code-verifier.0', '__Host-auth-flow-abcdef12-code-verifier.3'];
    for (const name of split) {
      expect(cookieWrite(name, 'v', { maxAge: 34560000, expires: new Date('2027-01-01T00:00:00Z') }).options, name).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 600 });
    }
    // 分割の接尾辞の形でないもの(先頭の 0 つき・数字でない・2 段)は外さない = 検証子の終わりにならないので寿命はそのまま。
    for (const name of ['__Host-auth-code-verifier.01', '__Host-auth-code-verifier.x', '__Host-auth-code-verifier.0.1', '__Host-auth-code-verifierx.0']) {
      expect(cookieWrite(name, 'v', { maxAge: 34560000 }).options, name).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 34560000 });
    }
    // 分割の消去はそのまま(寿命 0)。
    expect(cookieWrite('__Host-auth-code-verifier.0', '', { maxAge: 0 }).options).toEqual({ ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 });
  });

  it('消去の書き込みは値が空で寿命 0', () => {
    expect(expiredCookie('__Host-auth.0')).toEqual({ name: '__Host-auth.0', value: '', options: { ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 } });
  });

  it('セッションの系列は本体・分割・検証子で、似た別の名前は含まない', () => {
    for (const name of ['__Host-auth', '__Host-auth.0', '__Host-auth.12', '__Host-auth-code-verifier', '__Host-auth-flows-code-verifier', '__Host-auth-flow-abcdef12-code-verifier']) {
      expect(isSessionCookieName(name)).toBe(true);
    }
    for (const name of ['__Host-authx', '__Host-invite_code', 'auth', 'sb-127-auth-token']) {
      expect(isSessionCookieName(name)).toBe(false);
    }
  });

  it('移行前の既定の名前(sb-{ref}-auth-token とその分割・検証子)を見分ける', () => {
    for (const name of ['sb-127-auth-token', 'sb-abcdefghijklmnopqrst-auth-token.0', 'sb-127-auth-token-code-verifier']) {
      expect(isLegacySessionCookieName(name)).toBe(true);
    }
    for (const name of ['sb--auth-token', 'sb-127-auth-tokenx', '__Host-auth', 'sb-127-auth-token.x']) {
      expect(isLegacySessionCookieName(name)).toBe(false);
    }
  });

  it('運ぶ値の宣言は __Host- で始まり、セッションの系列と重ならず、寿命と上限が正の整数でなければ止める', () => {
    const valid = { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 64, pattern: /^[a-z]+$/ };
    expect(() => assertCarrySpec(valid)).not.toThrow();
    for (const broken of [
      { ...valid, name: 'carry' },
      { ...valid, name: '__Host-auth-carry' },
      { ...valid, field: '' },
      { ...valid, maxAgeSeconds: 0 },
      { ...valid, maxAgeSeconds: 1.5 },
      { ...valid, maxLength: 0 },
      { ...valid, maxLength: 2.5 },
      { ...valid, pattern: /[a-z]+$/ },
      { ...valid, pattern: /^[a-z]+/ },
      { ...valid, pattern: /^[a-z]+$/g },
      { ...valid, pattern: /^[a-z]+$/y },
    ]) {
      expect(() => assertCarrySpec(broken)).toThrow(/約束を守っていません/);
    }
  });

  // 点検 20 回目 B20-2: 字面の先頭の ^ と末尾の $ だけでは全体を縛らない(点検の探りの 3 形を含む)。
  it.each([
    ['最上位の | (^ は左の枝、$ は右の枝にだけ掛かる)', /^[A-Za-z0-9_-]{43}|legacy$/],
    ['最上位の | を 3 つの枝で', /^a|b|c$/],
    ['m の旗(^ と $ が行の境にも当たる)', /^[A-Za-z0-9_-]{1,43}$/m],
    ['s の旗(. が改行にも当たる)', /^.{1,43}$/s],
    ['末尾の $ が字の $(エスケープ)', /^[a-z]+\$/],
    ['先頭の ^ が文字の集合の中', /[^a-z]+$/],
  ])('全体を縛らない形は止める: %s', (_title, pattern) => {
    const valid = { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 64, pattern };
    expect(() => assertCarrySpec(valid)).toThrow(/約束を守っていません/);
  });

  it.each([
    ['今の宣言', /^[A-Za-z0-9_-]{1,43}$/],
    ['全体を (?:…) で包んだ選言', /^(?:[A-Za-z0-9_-]{43}|legacy)$/],
    ['文字の集合の中の | と $', /^[a|$]+$/],
    ['エスケープした | と、末尾の \\ の後の $', /^a\|b\\$/],
    ['i の旗', /^[a-z]+$/i],
  ])('全体を縛る形は通す: %s', (_title, pattern) => {
    const valid = { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 64, pattern };
    expect(() => assertCarrySpec(valid)).not.toThrow();
  });

  it.each([
    ['形と長さに合う', 'abc', 'abc'],
    ['長さの上限ちょうど', 'a'.repeat(8), 'a'.repeat(8)],
    ['長すぎる', 'a'.repeat(9), null],
    ['形の外(NUL)', 'a\u0000b', null],
    ['形の外(区切り)', 'a;b', null],
    ['空', '', null],
    ['無い', undefined, null],
    ['null', null, null],
  ])('carriedValue: %s → %s(点検 19 回目 O19-3。帰り道は形の外の cookie を無いものとして読む)', (_name, value, expected) => {
    expect(carriedValue(value, { name: '__Host-carry', field: 'code', maxAgeSeconds: 600, maxLength: 8, pattern: /^[a-z]+$/ })).toBe(expected);
  });
});
