/**
 * **ログアウトの口**(POST)の中身。ヘッダのログアウトのボタンは、スクリプトを要らないフォームの送信でここを叩く。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-2
 *
 *   1. 要求の出どころを確かめる(同じオリジンのページから出たと確かめられなければ 403。`SameSite=Lax` は別のサイトからの
 *      POST に cookie を付けないので、二重の守りになる)
 *   2. サーバーのクライアントでセッションを閉じる。**範囲は「この端末だけ」**(`local`)。
 *      ほかの端末からのログアウトは、自分のセッションの一覧の束で別の操作にする
 *   3. 要求に載っていた認証の cookie を全部消す(ライブラリが消す分に加えて、検証子・運ぶ値・移行前の名前の残りも)。
 *      認証基盤への問い合わせが失敗しても —— ライブラリが error を返しても、**例外を投げても**(クライアントの組み立てを含む)——
 *      この端末の cookie は必ず消す(ログアウトを押した人を、ログインのまま残さない)。ライブラリがこの応答で書こうとした
 *      cookie も、値を載せずに全部消す側へ倒す(途中で更新したトークンを書き戻して、ログアウトの応答がセッションを配らない)
 *   4. 着地へ 303。`Clear-Site-Data` で、ブラウザに残ったこのサイトのキャッシュ・cookie・保存領域も消させる(V14.3.1)
 */

import { expiredCookie, isSessionCookieName } from './cookie-policy';
import type { CookieWrite } from './cookie-policy';
import { redirectResponse, refusalResponse, requestCookies, sameOriginPath } from './http-response';
import { isSameOriginRequest, isStateChangingMethod, recordOriginRefusal } from '@kaninabe/runtime/http/request-origin';
import type { Logger } from '@kaninabe/runtime/ports';
import { recordAuthEvent, requestIdOf, stdoutLogger } from '@kaninabe/runtime/security-log';
import { createSessionClient, legacyCookieRemovals } from './session-client';
import type { AuthEndpoint, AuthOnlyDatabase } from './session-client';

/** ブラウザに残ったこのサイトのデータを消させるヘッダの値(キャッシュ・cookie・保存領域)。 */
export const CLEAR_SITE_DATA = '"cache", "cookies", "storage"';

/** ログアウトの口の設定(製品が渡す)。 */
export interface SignOutConfig {
  /** 認証基盤の接続先。 */
  readonly endpoint: AuthEndpoint;
  /** ログアウトのあとの着地(同じオリジンの相対パス。通らなければ口は例外 — 外の URL にも `'/'` にも置き換えない)。 */
  readonly landingPath: string;
  /** ほかに消す cookie の名前(サインインの往復で運ぶ値など。`__Host-` で始まるもの)。 */
  readonly alsoExpire?: readonly string[];
  /**
   * 認証の事象(ログアウト・認証基盤のセッションを閉じられなかったこと・出どころの拒否)を記録する出力口(省略は標準出力。V16.3.1)。
   * 載せるのは事象・結末・実行者のメンバー ID・要求の識別子だけで、トークン・cookie・メールアドレスは載せない。
   */
  readonly logger?: Logger;
}

/** 署名を確かめたクレームのうち、実行者の ID(`sub`)を読む口(Supabase のクライアントの `auth.getClaims` の形)。 */
export interface SubjectReader {
  readonly auth: { getClaims?: () => Promise<{ readonly data: { readonly claims: { readonly sub?: unknown } } | null; readonly error: unknown }> };
}

/**
 * ログアウトする人のメンバー ID を、署名を確かめたクレームから読む(記録のため。読めなければ `null` で、ログアウトは止めない)。
 *
 * @param client - リクエストのセッションを載せたクライアント
 * @returns メンバー ID。未ログイン・期限切れ・読めない場合は `null`
 */
export async function subjectOf(client: SubjectReader): Promise<string | null> {
  try {
    const claims = await client.auth.getClaims?.();
    const subject = claims?.data?.claims.sub;
    return claims?.error === null && typeof subject === 'string' && subject !== '' ? subject : null;
  } catch {
    return null;
  }
}

/**
 * ログアウトの口を処理する。
 *
 * @param request - ブラウザからの要求(POST のフォーム送信)
 * @param config - 製品の設定
 * @returns 着地への 303(相対パス。認証の cookie を全部消し、`Clear-Site-Data` つき)、または 403 / 405
 * @throws {Error} `landingPath` が同じオリジンの相対パスでないとき(書いた人の誤り)
 */
export async function signOut(request: Request, config: SignOutConfig): Promise<Response> {
  const landing = sameOriginPath(config.landingPath, 'landingPath');
  const logger = config.logger ?? stdoutLogger;
  const requestId = requestIdOf(request.headers);
  if (!isStateChangingMethod(request.method)) return refusalResponse(405);
  if (!isSameOriginRequest(request)) {
    recordOriginRefusal(request.headers, logger);
    return refusalResponse(403);
  }

  const cookies = requestCookies(request);
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let actorId: string | null = null;
  let closed = false;
  try {
    const client = createSessionClient<AuthOnlyDatabase, 'public'>(config.endpoint, {
      getAll: () => cookies,
      setAll: (writes, cacheHeaders) => {
        written.push(...writes.map((write) => write.name));
        Object.assign(headers, cacheHeaders);
      },
    });
    actorId = await subjectOf(client);
    // 失敗(期限切れ・認証基盤に届かない)でも、下でこの端末の cookie を必ず消す。結果は記録にだけ使う(利用者の操作は変えない)。
    const closing = await client.auth.signOut({ scope: 'local' });
    closed = closing.error === null || closing.error === undefined;
  } catch {
    // 例外(認証基盤の応答の形の崩れ・ライブラリの不具合・設定の誤り)でも同じ: この端末の cookie を消す応答を必ず返す。
    // 理由は応答に書かない(ログアウトの成否は利用者の操作を変えない)。
  }

  const sweep: CookieWrite[] = [
    ...[...cookies.map((cookie) => cookie.name).filter(isSessionCookieName), ...written, ...(config.alsoExpire ?? [])].map(expiredCookie),
    ...legacyCookieRemovals(cookies),
  ];
  recordAuthEvent(logger, {
    event: closed ? 'signed_out' : 'sign_out_degraded',
    actorId,
    decision: closed ? 'session_ended' : 'backend_failed',
    requestId,
  });
  return redirectResponse(landing, sweep, { ...headers, 'Clear-Site-Data': CLEAR_SITE_DATA });
}
