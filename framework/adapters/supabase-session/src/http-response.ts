/**
 * 認証の口の応答を Web 標準の `Request` / `Response` の上で組む部品(Next.js に依らない)。
 *
 * cookie は `Set-Cookie` でしか渡さない(V3.3.4 の後半)。応答には必ずキャッシュの禁止を付ける ——
 * cookie を書いた応答・ログアウトの応答を、共有のキャッシュにもブラウザにも残させない。
 */

import { parse, serialize } from 'cookie';
import { safeReturnPath } from '@kaninabe/runtime/url';
import type { CookieWrite } from './cookie-policy';
import type { AuthEndpoint, RequestCookie } from './session-client';

/** 共有のキャッシュにもブラウザにも残させないヘッダの値。 */
export const NO_STORE = 'no-store';

/**
 * 要求の `Cookie` ヘッダを読む(値の無い・空の名前は捨てる)。
 *
 * @param request - 受け取った要求
 * @returns 要求の cookie
 */
export function requestCookies(request: Request): RequestCookie[] {
  const header = request.headers.get('cookie');
  if (header === null || header === '') return [];
  return Object.entries(parse(header)).flatMap(([name, value]) => (name === '' || value === undefined ? [] : [{ name, value }]));
}

/**
 * 書き込み 1 本を `Set-Cookie` の値にする。
 *
 * @param write - 約束どおりの書き込み
 * @returns `Set-Cookie` の値
 */
export function setCookieValue(write: CookieWrite): string {
  return serialize(write.name, write.value, write.options);
}

/**
 * 同じ名前の書き込みは後のものだけを残す(1 つの応答に同じ cookie を 2 回書かない)。
 *
 * @param writes - 書き込みの並び
 * @returns 名前ごとに 1 本の並び(最初に現れた順)
 */
export function lastWritePerName(writes: readonly CookieWrite[]): CookieWrite[] {
  const byName = new Map<string, CookieWrite>();
  for (const write of writes) {
    byName.delete(write.name);
    byName.set(write.name, write);
  }
  return [...byName.values()];
}

/**
 * 製品が渡した着地(ログアウトのあと・サインインを始められなかったとき)を、転送の部品と同じ判定(`safeReturnPath`。同じオリジンの
 * 相対パスだけ)に通す(点検 10 回目 B10-2)。通らなければ書いた人の誤りとして例外にする —— 外の URL にも `'/'` にも置き換えない。
 *
 * @param value - 製品の設定の値
 * @param field - 設定の欄の名前(例外の文面に使う。値は載せない)
 * @returns 正規化した相対パス
 * @throws {Error} 同じオリジンの相対パスでないとき
 */
export function sameOriginPath(value: string, field: string): string {
  const path = safeReturnPath(value);
  if (path === null) throw new Error(`${field} は同じオリジンの相対パス(/ で始まり // でも /\\ でもない)で書いてください`);
  return path;
}

/**
 * サインインの開始の口が外へ転送してよい行き先(認証基盤の接続先のオリジン 1 つだけ)。Route Handler の出口の関所
 * (`guardRoute` の `externalOrigins`)に渡す閉じた表で、J2 が認証の `start` の口にだけ許す。
 *
 * @param backend - 認証基盤の接続先
 * @returns 完全なオリジン 1 つの並び
 */
export function authRedirectOrigins(backend: Pick<AuthEndpoint, 'url'>): readonly string[] {
  return [new URL(backend.url).origin];
}

/**
 * 転送(303)の応答を組む(**パッケージの中だけの部品**。公開の入口からは出さない — 点検 10 回目 B10-2。行き先は呼び手が
 * `sameOriginPath` か、認証基盤のオリジンに一致することを確かめた認可の URL だけを渡す)。
 *
 * @param location - 転送先(同じオリジンの相対パスか、認証基盤のオリジンの認可の URL)
 * @param writes - 書く cookie
 * @param headers - 付けるヘッダ(キャッシュの禁止は常に付く)
 * @returns 応答
 */
export function redirectResponse(location: string, writes: readonly CookieWrite[], headers: Readonly<Record<string, string>> = {}): Response {
  const response = new Response(null, { status: 303, headers: { ...headers, 'Cache-Control': NO_STORE, Location: location } });
  for (const write of lastWritePerName(writes)) response.headers.append('Set-Cookie', setCookieValue(write));
  return response;
}

/**
 * 本文の無い拒否の応答(理由は本文に書かない)。
 *
 * @param status - HTTP のステータス(403 / 400 / 405)
 * @returns 応答
 */
export function refusalResponse(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': NO_STORE } });
}
