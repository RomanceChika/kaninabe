/**
 * **サインインの開始の口**(POST)の中身。ブラウザのログインボタンは、スクリプトを要らないフォームの送信でここを叩く。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-2
 *
 * 段取りは 4 つで、製品ごとに変わるところは設定(`SignInStartConfig`)だけである:
 *
 *   1. 要求の出どころを確かめる(状態を変える要求で、同じオリジンのページから出たと確かめられなければ 403。判定は実行時パッケージの
 *      `@kaninabe/runtime/http/request-origin` の 1 つだけを使う —— 製品の口も最初に同じ部品の `refuseCrossOrigin` を呼ぶので二重の守りになる)
 *   2. フォームの本文からサインインの往復で運ぶ値を読み、約束の属性で cookie に書く(長すぎれば 400・本文が上限を超えれば 413。無ければ古い値を消す)
 *   3. サーバーのクライアントで OAuth を始める。PKCE の検証子は、そのときライブラリが cookie に書く
 *      (**転送の応答に載せないと、帰り道でコードを交換できない**。Supabase の公式文書の注意)
 *   4. 認可の URL へ 303 で転送する(失敗したら、決めておいた失敗の着地へ 303)
 *
 * スクリプトの `document.cookie` は使わない。検証子も運ぶ値も、スクリプトから読めない cookie になる。
 */

import type { Provider } from '@supabase/supabase-js';
import { assertCarrySpec, carriedValue, cookieWrite, expiredCookie } from './cookie-policy';
import type { CarryCookieSpec, CookieWrite } from './cookie-policy';
import { redirectResponse, refusalResponse, requestCookies, sameOriginPath } from './http-response';
import { readBodyLimited } from '@kaninabe/runtime/http/paid-entry';
import { isSameOriginRequest, isStateChangingMethod, recordOriginRefusal } from '@kaninabe/runtime/http/request-origin';
import type { Logger } from '@kaninabe/runtime/ports';
import { recordAuthEvent, requestIdOf, stdoutLogger } from '@kaninabe/runtime/security-log';
import { createSessionClient } from './session-client';
import type { AuthEndpoint, AuthOnlyDatabase } from './session-client';

/** サインインの開始の口の設定(製品が渡す)。 */
export interface SignInStartConfig {
  /** 認証基盤の接続先。 */
  readonly endpoint: AuthEndpoint;
  /** OAuth のプロバイダ(認証フロー仕様の `providers` の 1 つ)。 */
  readonly provider: Provider;
  /** 帰り道の口のパス(認証フロー仕様が宣言した OAuth の帰り道)。要求と同じオリジンの絶対 URL にして渡す。 */
  readonly callbackPath: string;
  /** 始められなかったときの着地(同じオリジンの相対パス。通らなければ口は例外 — 外の URL にも `'/'` にも置き換えない)。 */
  readonly failurePath: string;
  /** サインインの往復で運ぶ値(任意)。 */
  readonly carry?: CarryCookieSpec;
  /**
   * 認証の事象(開始・開始の失敗・出どころの拒否)を記録する出力口(省略は標準出力。V16.3.1)。
   * 載せるのは事象・結末・要求の識別子だけで、トークン・メールアドレス・運ぶ値は載せない。
   */
  readonly logger?: Logger;
}

/**
 * 本文の最大バイト数。運ぶ値は招待コードのような短い 1 欄(`carry.maxLength` は数十字)なので、フォームの枠(multipart の境界・欄名)を
 * 足しても数 KB で足りる。この口は**未ログインの誰にでも届く**(出どころのヘッダはブラウザを使わない相手が自由に付けられる)ので、
 * 読む前に `Content-Length` で、読みながら実際の量で打ち切る(どちらか片方だけだと、長さを偽る・省く本文が全部読まれる)。
 */
export const CARRY_BODY_LIMIT_BYTES = 4096;

/** 運ぶ値の読み取りの結末。 */
type CarryRead =
  | { readonly kind: 'ok'; readonly writes: readonly CookieWrite[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' };

/**
 * フォームの本文から運ぶ値を読み、書き込みにする。
 *
 * @param request - 受け取った要求
 * @param carry - 運ぶ値の宣言(無ければ本文を読まない)
 * @returns 書き込み、本文が読めない、または大きすぎる
 */
async function readCarry(request: Request, carry: CarryCookieSpec | undefined): Promise<CarryRead> {
  if (carry === undefined) return { kind: 'ok', writes: [] };
  const body = await readBodyLimited(request, CARRY_BODY_LIMIT_BYTES);
  if (body.kind === 'too_large') return { kind: 'too_large' };
  if (body.kind === 'missing') return { kind: 'invalid' };
  let form: FormData;
  try {
    // 上限の中に収まった本文だけを、元の Content-Type(multipart の境界を含む)でフォームとして読み直す。
    form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '' }, body: body.bytes as BodyInit }).formData();
  } catch {
    return { kind: 'invalid' };
  }
  const value = form.get(carry.field);
  if (value === null || value === '') return { kind: 'ok', writes: [expiredCookie(carry.name)] };
  if (typeof value !== 'string' || carriedValue(value, carry) === null) return { kind: 'invalid' };
  return { kind: 'ok', writes: [cookieWrite(carry.name, value, { maxAge: carry.maxAgeSeconds })] };
}

/**
 * サインインの開始の口を処理する。
 *
 * @param request - ブラウザからの要求(POST のフォーム送信)
 * @param config - 製品の設定
 * @returns 認可の URL への 303(検証子と運ぶ値の cookie つき)、失敗の着地(相対パス)への 303、または 403 / 400 / 413 / 405
 * @throws {Error} `failurePath` が同じオリジンの相対パスでないとき(書いた人の誤り)
 */
export async function startSignIn(request: Request, config: SignInStartConfig): Promise<Response> {
  const failurePath = sameOriginPath(config.failurePath, 'failurePath');
  if (config.carry !== undefined) assertCarrySpec(config.carry);
  const logger = config.logger ?? stdoutLogger;
  const requestId = requestIdOf(request.headers);
  if (!isStateChangingMethod(request.method)) return refusalResponse(405);
  if (!isSameOriginRequest(request)) {
    recordOriginRefusal(request.headers, logger);
    return refusalResponse(403);
  }
  const carried = await readCarry(request, config.carry);
  if (carried.kind === 'too_large') {
    recordAuthEvent(logger, { event: 'sign_in_start_failed', actorId: null, decision: 'invalid_form', requestId });
    return refusalResponse(413);
  }
  if (carried.kind === 'invalid') {
    recordAuthEvent(logger, { event: 'sign_in_start_failed', actorId: null, decision: 'invalid_form', requestId });
    return refusalResponse(400);
  }

  const writes: CookieWrite[] = [...carried.writes];
  const headers: Record<string, string> = {};
  const cookies = requestCookies(request);
  const client = createSessionClient<AuthOnlyDatabase, 'public'>(config.endpoint, {
    getAll: () => cookies,
    setAll: (written, cacheHeaders) => {
      writes.push(...written);
      Object.assign(headers, cacheHeaders);
    },
  });
  const origin = new URL(request.url).origin;
  const started = await client.auth.signInWithOAuth({
    provider: config.provider,
    options: { redirectTo: new URL(config.callbackPath, origin).toString(), skipBrowserRedirect: true },
  });
  const outcome = startOutcome(started, writes, failurePath, new URL(config.endpoint.url).origin);
  recordAuthEvent(logger, { ...startEventOf(outcome), actorId: null, requestId });
  return redirectResponse(outcome.destination, outcome.writes, headers);
}

/** OAuth を始めた結果の形(ライブラリの戻り値のうち、ここが読む 2 欄)。 */
export interface OAuthStartResult {
  readonly data: { readonly url: string | null };
  readonly error: unknown;
}

/** 開始の口の転送先と、そこへ載せる cookie。 */
export interface StartOutcome {
  readonly destination: string;
  readonly writes: readonly CookieWrite[];
  /** 始められなかった(失敗の着地へ送る)か。記録の事象を分ける。 */
  readonly failed: boolean;
}

/**
 * 開始の結末から、記録する事象とその結末(`decision`)を決める。
 *
 * @param outcome - 開始の結末
 * @returns 認証の事象の ID と結末
 */
export function startEventOf(outcome: StartOutcome): { readonly event: 'sign_in_started' | 'sign_in_start_failed'; readonly decision: string } {
  return outcome.failed ? { event: 'sign_in_start_failed', decision: 'start_failed' } : { event: 'sign_in_started', decision: 'redirected' };
}

/**
 * 認可の URL が認証基盤のオリジンの絶対 URL か(http / https だけ。解けない綴りは偽)。
 *
 * @param url - ライブラリが返した認可の URL
 * @param authOrigin - 認証基盤の接続先のオリジン
 * @returns 一致すれば true
 */
function atAuthOrigin(url: string, authOrigin: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.origin === authOrigin;
}

/**
 * OAuth を始めた結果から転送先を決める。始められなかった(エラー・URL が空)・**認可の URL が認証基盤のオリジンでない**なら、
 * cookie を載せずに失敗の着地へ送る。
 *
 * いまのライブラリはこの口でエラーを返さない(URL を組み立てるだけ)が、型はエラーの形を持つので、黙って空の転送をしない。
 * 外へ出してよい行き先は認証基盤のオリジンだけ(Route Handler の出口の関所の `externalOrigins` と同じ 1 つ。点検 10 回目 B10-2)。
 *
 * @param result - `signInWithOAuth` の戻り値
 * @param writes - 成功したときに載せる cookie(検証子と運ぶ値)
 * @param failurePath - 失敗の着地(同じオリジンの相対パス。呼び手が `sameOriginPath` に通したもの)
 * @param authOrigin - 認証基盤の接続先のオリジン
 * @returns 転送先と載せる cookie
 */
export function startOutcome(result: OAuthStartResult, writes: readonly CookieWrite[], failurePath: string, authOrigin: string): StartOutcome {
  const url = result.data.url;
  if (result.error !== null || url === null || !atAuthOrigin(url, authOrigin)) return { destination: failurePath, writes: [], failed: true };
  return { destination: url, writes, failed: false };
}
