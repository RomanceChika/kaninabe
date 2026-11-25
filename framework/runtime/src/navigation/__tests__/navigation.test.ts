/**
 * サーバーの転送 `safeRedirect`(`server.ts`)とクライアントの遷移の口 `safeNavigator`(`client.ts`)のテスト(ASVS V3.7.2。
 * 点検 9 回目 B9-1・B9-3・B9-6)。
 *
 * `safeRedirect` は Next.js の `redirect` / `permanentRedirect` が投げる転送の合図(`digest` = `NEXT_REDIRECT;…;行き先;状態;`)を
 * そのまま受けて、行き先とステータスを読む(枠のモジュールは差し替えない)。クライアントの口は、ルーターとページ全体の遷移の口を
 * 記録用の偽物で渡して、行き先が同じオリジンの相対パスに限られることを見る(`useSafeNavigate` はこの関数を `useMemo` で包むだけ)。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeRedirect } from '../server';
import { safeNavigator } from '../client';

/**
 * 転送の合図から行き先とステータスを取り出す。
 *
 * @param run - 転送する処理
 * @returns 行き先とステータス
 */
function redirectOf(run: () => unknown): { readonly target: string; readonly status: string } {
  try {
    run();
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '');
    const [kind, , target, status] = digest.split(';');
    expect(kind).toBe('NEXT_REDIRECT');
    return { target: target ?? '', status: status ?? '' };
  }
  throw new Error('転送の合図が投げられなかった');
}

/** 外のオリジンへ出る行き先(探り台本の綴り)。 */
const HOSTILE = ['https://evil.example/login', '//evil.example', '/\\evil.example', '/\t/evil.example', '/.//evil.example', 'javascript:alert(1)', '', null, undefined];

describe('safeRedirect(サーバーの転送)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SAFEREDIRECT-002
  it('外のオリジンへ出る行き先は転送せず、既定の行き先に置き換わる(恒久の転送も同じ)', () => {
    expect(HOSTILE.length).toBeGreaterThan(0);
    for (const next of HOSTILE) {
      expect(redirectOf(() => safeRedirect(next, { fallback: '/login' })).target, String(next)).toBe('/login');
      expect(redirectOf(() => safeRedirect(next, { fallback: '/login', permanent: true })), String(next)).toEqual({ target: '/login', status: '308' });
    }
  });

  it('同じオリジンの相対パスは正規化して転送する(既定は一時の転送 307)', () => {
    expect(redirectOf(() => safeRedirect('/items/./abc?x=1'))).toEqual({ target: '/items/abc?x=1', status: '307' });
    expect(redirectOf(() => safeRedirect('https://evil.example')).target).toBe('/');
  });

  it('既定の行き先の書き間違いは転送せず例外', () => {
    expect(() => safeRedirect('//evil.example', { fallback: '//evil.example' })).toThrow(/同じオリジンの相対パス/u);
  });
});

describe('safeNavigator(クライアントの遷移の口)', () => {
  /** 記録用のルーターとページ全体の遷移の口。 */
  function recorder(): { readonly calls: string[]; readonly navigator: ReturnType<typeof safeNavigator> } {
    const calls: string[] = [];
    const navigator = safeNavigator(
      { push: (href) => calls.push(`push ${href}`), replace: (href) => calls.push(`replace ${href}`), refresh: () => calls.push('refresh') },
      (href) => calls.push(`assign ${href}`),
    );
    return { calls, navigator };
  }

  // @spec framework-guarantee-catalog @tc TC-FW-SAFEREDIRECT-003
  it('push / replace / assign は外のオリジンへ出る行き先を渡さず、既定の行き先に置き換わる', () => {
    expect(HOSTILE.length).toBeGreaterThan(0);
    for (const next of HOSTILE) {
      const { calls, navigator } = recorder();
      navigator.push(next);
      navigator.replace(next, '/home');
      navigator.assign(next, '/login');
      expect(calls, String(next)).toEqual(['push /', 'replace /home', 'assign /login']);
    }
  });

  it('同じオリジンの相対パスはそのまま渡し、refresh は行き先を持たない', () => {
    const { calls, navigator } = recorder();
    navigator.push('/a?b=1#c');
    navigator.replace('/x/../y');
    navigator.assign('/z');
    navigator.refresh();
    expect(calls).toEqual(['push /a?b=1#c', 'replace /y', 'assign /z', 'refresh']);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ページ全体の遷移の既定の口は window.location.assign で、行き先は同じ判定を通る', () => {
    const assigned: string[] = [];
    vi.stubGlobal('window', { location: { assign: (href: string) => assigned.push(href) } });
    const navigator = safeNavigator({ push: () => undefined, replace: () => undefined, refresh: () => undefined });
    navigator.assign('https://evil.example', '/login');
    navigator.assign('/items');
    expect(assigned).toEqual(['/login', '/items']);
  });

  it('既定の行き先の書き間違いは遷移せず例外', () => {
    const { calls, navigator } = recorder();
    expect(() => navigator.assign('https://evil.example', 'https://evil.example')).toThrow(/同じオリジンの相対パス/u);
    expect(calls).toEqual([]);
  });
});
