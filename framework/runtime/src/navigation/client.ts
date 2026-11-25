/**
 * **クライアント側の遷移を作る唯一の部品**(ASVS V3.7.2。点検 9 回目 B9-1・B9-6)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md §転送は安全な部品だけ
 *
 * 製品のコードはルーター(`next/navigation` / `next/router` の `useRouter`)も、ブラウザの遷移の口(`location` への代入・
 * `location.assign` / `replace`・`window.open`・`<meta http-equiv="refresh">`)も使えない(ESLint の
 * `layer/require-safe-redirect`)。クライアントの遷移は {@link useSafeNavigate} が返す口から呼び、行き先は核の
 * {@link safeReturnPathOr}(同じオリジンの相対パスだけ)を必ず通る。ルーターそのものは外へ渡さない
 * (渡すと `navigator.router.push(next)` のような別名で生の口が戻る)。
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { safeReturnPathOr } from '../domain/url.js';

/** クライアントの遷移の口(行き先はどれも同じオリジンの相対パスに限る)。 */
export interface SafeNavigator {
  /** 履歴に積んで移る(ルーターの `push`)。 */
  readonly push: (path: string | null | undefined, fallback?: string) => void;
  /** 今の履歴を置き換えて移る(ルーターの `replace`)。 */
  readonly replace: (path: string | null | undefined, fallback?: string) => void;
  /** ページ全体を読み直して移る(`window.location.assign`。セッションを読み直したいとき)。 */
  readonly assign: (path: string | null | undefined, fallback?: string) => void;
  /** 今の画面のサーバーの描画を取り直す(ルーターの `refresh`。行き先を持たない)。 */
  readonly refresh: () => void;
}

/** ルーターの口のうち、この部品が使う 3 つ(テストで差し替える形)。 */
export interface RouterLike {
  readonly push: (href: string) => void;
  readonly replace: (href: string) => void;
  readonly refresh: () => void;
}

/**
 * ルーターとページ全体の遷移の口から、安全な遷移の口を組む(フックの中身。テストはここを直に呼ぶ)。
 *
 * @param router - ルーター(`useRouter()`)
 * @param assignLocation - ページ全体を読み直して移る口(既定は `window.location.assign`)
 * @returns 安全な遷移の口
 */
export function safeNavigator(router: RouterLike, assignLocation: (href: string) => void = (href) => window.location.assign(href)): SafeNavigator {
  return {
    push: (path, fallback) => router.push(safeReturnPathOr(path, fallback)),
    replace: (path, fallback) => router.replace(safeReturnPathOr(path, fallback)),
    assign: (path, fallback) => assignLocation(safeReturnPathOr(path, fallback)),
    refresh: () => router.refresh(),
  };
}

/**
 * クライアントの部品で遷移の口を得る(`useRouter` の代わり)。返す口はルーターが同じあいだ同じものである(依存の配列に置ける)。
 *
 * @returns 安全な遷移の口
 */
export function useSafeNavigate(): SafeNavigator {
  const router = useRouter();
  return useMemo(() => safeNavigator(router), [router]);
}
