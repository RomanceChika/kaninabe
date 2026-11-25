/**
 * Route Handler の転送の応答の部品(`redirect.ts`。ASVS V3.7.2。点検 9 回目 B9-2)のテスト。
 *
 * 確かめるのは 3 つ —— ①行き先は同じオリジンの相対パスだけが `Location` に載り、通らない値(外の URL・`//`・`/\`・制御文字・
 * 正規化で `//` に畳まれる綴り)は既定の行き先に置き換わる ②呼び出し側の見出しは残るが、`Location` と `Refresh` はこの部品が決め直す・消す
 * ③既定は 303 で本文なし、既定の行き先の書き間違いは例外。
 */

import { describe, expect, it } from 'vitest';
import { safeRedirectResponse } from '../redirect';

describe('safeRedirectResponse', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SAFEREDIRECT-001
  it('外のオリジンへ出る行き先は Location に載らず、既定の行き先に置き換わる', () => {
    const hostile = ['https://evil.example/login', '//evil.example', '/\\evil.example', '/\t/evil.example', '/.//evil.example', 'javascript:alert(1)', 'evil.example', '', null, undefined];
    expect(hostile.length).toBeGreaterThan(0);
    for (const next of hostile) {
      const response = safeRedirectResponse(next, { fallback: '/login' });
      expect(response.headers.get('location'), String(next)).toBe('/login');
    }
  });

  it.each([
    ['相対パス', '/items/abc?tab=x#y', '/items/abc?tab=x#y'],
    ['ドットの区画は畳む', '/a/./b/../c', '/a/c'],
    ['パーセントエンコードした斜線はパスのまま', '/%2F%2Fevil.example', '/%2F%2Fevil.example'],
  ])('通す: %s', (_name, next, expected) => {
    expect(safeRedirectResponse(next).headers.get('location')).toBe(expected);
  });

  it('既定は 303・本文なしで、ステータスとほかの見出しは渡せる', async () => {
    const response = safeRedirectResponse('/x');
    expect(response.status).toBe(303);
    expect(await response.text()).toBe('');
    const custom = safeRedirectResponse('/x', { status: 307, headers: { 'Cache-Control': 'no-store' } });
    expect(custom.status).toBe(307);
    expect(custom.headers.get('cache-control')).toBe('no-store');
  });

  it('呼び出し側の Location と Refresh は決め直す・消す(見出しを経由して外へ出さない)', () => {
    const response = safeRedirectResponse('/x', { headers: { Location: 'https://evil.example', Refresh: '0; url=https://evil.example' } });
    expect(response.headers.get('location')).toBe('/x');
    expect(response.headers.get('refresh')).toBeNull();
  });

  it('値が通らず既定の行き先も書き間違い(外の URL)なら例外', () => {
    expect(() => safeRedirectResponse('https://evil.example', { fallback: 'https://evil.example' })).toThrow(/同じオリジンの相対パス/u);
  });
});
