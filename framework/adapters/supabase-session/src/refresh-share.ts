/**
 * **更新を 1 本に寄せる**(single-flight): 1 要求の段の中の更新を、認証基盤への 1 回にする。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-3(締め出しの連鎖。`session-scope.ts` の冒頭)
 *
 * - 段がすでに受け取ったセッションが生きていれば、段が知っている更新トークン(要求の cookie のもの・段で受け取ったもの)の更新は、
 *   **認証基盤へ出さずに**そのセッションで答える。1 要求の中で世代を何段も進めない(測りでは 1 要求が約 7 回更新していた)。
 * - 後段(`downstream`)は、要求の cookie のアクセストークンが本当に生きている間は更新しない(cookie のセッションで答える)。
 *   前段が同じ要求で更新したセッションを、描画がもう一度回さない。
 * - 生きていなければ、段のいちばん新しい更新トークンを更新する(古いトークンから枝を伸ばさない)。同じトークンの更新が段の中で
 *   走っている間に来た呼び手は、その答えを待つ(段のクライアントが並んで読んでも 1 回)。
 * - 認証基盤への 1 回は自分の締め切り(`SHARED_ATTEMPT_LIMIT_MS`)で打ち切る。**締め切りのあとに着いた答えは捨てる**(cookie にならない)。
 *   待つ側も自分の締め切り(呼び手の信号)で抜ける。
 *
 * **要求をまたいだ寄せはしない。** プロセスに表を持つと、モジュールの状態の禁止(`layer/no-module-state`。書き込みは理由つきでも許さない)に
 * 当たり、サーバーレスの別の実体には届かない。並列の要求どうしは、認証基盤の「進んだ子の親なら同じ子を返す」規則で同じ世代に収まる
 * (段が 1 要求で 1 回しか進めないので、親子の 1 段に収まる)。
 *
 * アクセストークンの寿命がライブラリの更新の余裕(90 秒)以下だと、読みのたびに更新が走る。前段が認証基盤の答えでそれを見たら警告を出す
 * (止めない。理由は `JWT_LIFETIME_FLOOR_SECONDS`)。
 */

import { jsonResponse, textResponse } from '@kaninabe/runtime/http/response';
import type { Logger } from '@kaninabe/runtime/ports';
import { stdoutLogger } from '@kaninabe/runtime/security-log';
import { REFRESH_TIME_LIMIT_MS, isRefreshRequest } from './refresh-guard';
import { adoptRequestSession, isFresh, recordHead, sessionCookieValueOf, snapshotOf, snapshotOfCookieValue } from './session-scope';
import type { RefreshOutcome, SessionScope, SessionSnapshot } from './session-scope';

/** 認証基盤への 1 回の更新の締め切り(ミリ秒)。1 要求の更新の時間と同じ。 */
export const SHARED_ATTEMPT_LIMIT_MS = REFRESH_TIME_LIMIT_MS;

/**
 * ライブラリ(`@supabase/auth-js`)の更新の余裕(秒)。アクセストークンの残りがこれより短いと、読みのたびに更新する
 * (`EXPIRY_MARGIN_MS` = 30 秒 × 3)。アクセストークンの寿命はこれより長くなければならない。
 *
 * 実行時は警告にとどめる(止めない): 寿命を決めるのは認証基盤の設定(本番の管理画面・測りの環境変数)で、製品からは変えられない。
 * 止めると全部の要求が落ちる。寄せ(このファイル)があれば、短い寿命でも 1 要求で世代を何段も進めない。
 * 手元の設定(プラットフォームのローカル設定の `[auth] jwt_expiry`)は検査 H5 が error で止める。
 */
export const JWT_LIFETIME_FLOOR_SECONDS = 90;

/** 本文を持てない状態。 */
const NULL_BODY_STATUSES: readonly number[] = [204, 205, 304];

/** 本文の更新トークン(文字列の JSON 本文の `refresh_token` だけを読む。形の検査は `refresh-guard.ts` が先に済ませている)。 */
function refreshTokenOf(body: RequestInit['body']): string | null {
  if (typeof body !== 'string') return null;
  const { refresh_token: token } = JSON.parse(body) as { readonly refresh_token?: unknown };
  return typeof token === 'string' ? token : null;
}

/**
 * 寿命の短い答えなら、警告の 1 行を返す(本文の `expires_in` が `JWT_LIFETIME_FLOOR_SECONDS` 以下)。
 *
 * @param body - 認証基盤の成功の答えの本文
 * @returns 警告の文(短くなければ null)
 */
export function shortLifetimeWarning(body: string): string | null {
  const { expires_in: expiresIn } = JSON.parse(body) as { readonly expires_in?: unknown };
  if (typeof expiresIn !== 'number' || expiresIn > JWT_LIFETIME_FLOOR_SECONDS) return null;
  return (
    `アクセストークンの寿命(${String(expiresIn)} 秒)が、ライブラリの更新の余裕(${String(JWT_LIFETIME_FLOOR_SECONDS)} 秒)以下です。読みのたびに更新が走ります。` +
    '認証基盤の JWT の寿命(jwt_expiry / GOTRUE_JWT_EXP)を 90 秒より長くしてください'
  );
}

/**
 * 認証基盤へ 1 回出し、本文まで読み切る。**締め切りのあとに着いた答えは null**(信号を無視する `fetch` でも捨てる)。
 *
 * @param base - 下の `fetch`
 * @param input - 宛先
 * @param init - 要求(信号は締め切りに差し替える)
 * @param deadline - 締め切りの信号
 * @returns 読み切った答え
 */
export async function settleBefore(base: typeof fetch, input: RequestInfo | URL, init: RequestInit, deadline: AbortSignal): Promise<RefreshOutcome | null> {
  const response = await base(input, { ...init, signal: deadline }).catch(() => null);
  if (response === null) return null;
  const body = await response.text().catch(() => null);
  if (body === null || deadline.aborted) return null;
  return { status: response.status, headers: [...response.headers], body };
}

/**
 * 待つ側の締め切り(呼び手の信号)で抜ける。抜けたら null(届かなかったのと同じ)。
 *
 * @param promise - 待つ答え
 * @param signal - 呼び手の信号
 * @returns 答え(抜けたら null)
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T | null> {
  if (signal === null || signal === undefined) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const abandon = (): void => {
      resolve(null);
    };
    signal.addEventListener('abort', abandon, { once: true });
    void promise.then((value) => {
      signal.removeEventListener('abort', abandon);
      resolve(value);
    });
  });
}

/** JSON として読める本文か(読めればその値)。 */
function jsonOf(body: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(body) as unknown };
  } catch {
    return null;
  }
}

/**
 * 読み切った答えから、呼び手ごとの新しい応答を作る(本文の型は読み直す。ライブラリは型を見ずに JSON として読む)。
 *
 * @param outcome - 読み切った答え
 * @returns 応答
 */
export function responseOf(outcome: RefreshOutcome): Response {
  const headers = new Headers();
  for (const [name, value] of outcome.headers) if (name !== 'content-length' && name !== 'content-encoding') headers.append(name, value);
  const init = { status: outcome.status, headers };
  if (NULL_BODY_STATUSES.includes(outcome.status)) return new Response(null, init);
  const json = jsonOf(outcome.body);
  return json === null ? textResponse(outcome.body, init) : jsonResponse(json.value, init);
}

/** セッションで答える(認証基盤へ出さない)。 */
function answer(snapshot: SessionSnapshot): Response {
  return responseOf({ status: 200, headers: [], body: snapshot.body });
}

/** 段の中で、更新トークン 1 つの更新を 1 本にする(走っていれば待ち、無ければ始める)。 */
function sharedRefresh(scope: SessionScope, base: typeof fetch, target: string, input: RequestInfo | URL, init: RequestInit, logger: Logger): Promise<RefreshOutcome | null> {
  const running = scope.pending.get(target);
  if (running !== undefined) return running;
  const started = settleBefore(base, input, init, AbortSignal.timeout(SHARED_ATTEMPT_LIMIT_MS)).then((outcome) => {
    scope.pending.delete(target);
    const warning = outcome?.status === 200 && scope.stage === 'front' ? shortLifetimeWarning(outcome.body) : null;
    if (warning !== null) logger.write({ level: 'warn', message: warning });
    return outcome;
  });
  scope.pending.set(target, started);
  return started;
}

/**
 * 更新の口の要求を段で寄せる `fetch` を作る(ほかの口はそのまま下へ渡す)。`unavailableUnlessSignedOut` の下に置く。
 *
 * @param base - 下の `fetch`
 * @param scope - 要求の段の台帳
 * @param requestCookies - 要求の cookie(後段が、cookie のセッションが生きているかを見る)
 * @param logger - 寿命の警告の出口(省略は標準出力)
 * @returns 寄せる `fetch`
 */
export function coalescedRefresh(base: typeof fetch, scope: SessionScope, requestCookies: () => readonly { readonly name: string; readonly value: string }[], logger: Logger = stdoutLogger): typeof fetch {
  return async (input, init) => {
    const token = isRefreshRequest(input) ? refreshTokenOf(init?.body) : null;
    if (token === null) return base(input, init);
    const now = Date.now();
    const { head } = scope;
    const known = scope.generations.has(token);
    if (head !== null && known && isFresh(head.snapshot, now)) return answer(head.snapshot);
    if (scope.stage === 'downstream' && head === null) {
      const own = snapshotOfCookieValue(sessionCookieValueOf(requestCookies()));
      if (own?.refreshToken === token && isFresh(own, now)) {
        adoptRequestSession(scope, own);
        return answer(own);
      }
    }
    const target = head !== null && known ? head.snapshot.refreshToken : token;
    const sent: RequestInit = { ...init, body: JSON.stringify({ refresh_token: target }) };
    const outcome = await untilAborted(sharedRefresh(scope, base, target, input, sent, logger), init?.signal);
    if (outcome === null) throw new TypeError('fetch failed');
    const snapshot = outcome.status === 200 ? snapshotOf(outcome.body) : null;
    if (snapshot !== null) recordHead(scope, target, snapshot);
    return responseOf(outcome);
  };
}
