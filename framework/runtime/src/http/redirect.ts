/**
 * **Route Handler の転送の応答を作る唯一の部品**(ASVS V3.7.2。点検 9 回目 B9-2)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md
 *
 * 製品のコードは転送の応答を自分で組めない —— `NextResponse.redirect` / `Response.redirect` / 見出しの `Location` と
 * `Refresh` の鍵(`new Response(null, { headers: { Location } })`・`headers.set('Location', …)`)は ESLint の
 * `layer/require-safe-redirect` が全部止める。転送の応答はここで作り、行き先は核の {@link safeReturnPathOr}
 * (同じオリジンの相対パスだけ。`//`・`/\`・スキーム・制御文字・正規化で `//` に畳まれる綴りを拒む)を必ず通る。
 *
 * `Location` は**相対パスのまま**書く(RFC 9110 §10.2.2 は相対の参照を許し、ブラウザは要求の URL に対して解く)。
 * 絶対 URL を組むための基底(`new URL(path, base)`)を受け取らないので、基底のオリジンを利用者の値にする形(B9-5)も無い。
 */

import { safeReturnPathOr } from '../domain/url.js';

/** 転送に使う HTTP のステータス(303 が既定。フォームの送信のあとは GET に変える)。 */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

/** 転送の応答の組み方。 */
export interface SafeRedirectInit {
  /** 行き先が通らないときの行き先(書いた人が決める同じオリジンの相対パス。既定は `'/'`)。 */
  readonly fallback?: string;
  /** ステータス(既定は 303)。 */
  readonly status?: RedirectStatus;
  /** 付けるほかの見出し(`Location` と `Refresh` はこの部品が決め直す・消す)。 */
  readonly headers?: HeadersInit;
}

/**
 * 転送の応答を組む(本文なし)。
 *
 * @param path - 行き先の候補(利用者の値 `?next=` でも、生成した経路でもよい。通らなければ `fallback`)
 * @param init - 既定の行き先・ステータス・ほかの見出し
 * @returns 転送の応答
 * @throws {Error} `fallback` が同じオリジンの相対パスでないとき(書き間違い)
 */
export function safeRedirectResponse(path: string | null | undefined, init: SafeRedirectInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.delete('Refresh');
  headers.set('Location', safeReturnPathOr(path, init.fallback));
  return new Response(null, { status: init.status ?? 303, headers });
}
