/**
 * **更新の口の守り**: 更新トークンの更新(`POST …/token?grant_type=refresh_token`)の答えの読み替えと、1 要求の試行の予算。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-3(点検 15 回目 O15-2・16 回目 B16-1)
 *
 * ライブラリの読み方は 2 通りしかない。502 / 503 / 504 と通信の失敗は「今は答えられない」で、指数の待ち時間で 30 秒の手前まで再試行する。ほかの失敗は全部「更新トークンが死んだ」で、cookie を消す。
 * ここは次の 3 つを閉じる。
 *
 * 1. **読み替えるのは閉じた形だけ**: `409`・`429`・5xx・通信の失敗。どれもセッションの死を言い切らないので 503 にする(cookie を消さない)。**ほかの答えはそのままライブラリへ渡す**(`400 bad_json` を読み替えると、未ログインの細工の cookie 1 本で 25 秒居座る。B16-1)。
 * 2. **1 要求の予算**: 失敗の回数と時間に上限を持つ。超えたら閉じる = cookie を消さず、利用者を読めないまま終える(`SessionUnreadableError`)。ライブラリの再試行に任せると 1 要求が 25 秒以上居座る。
 * 3. **形の壊れた更新トークンは送らない**: 文字列でない値・認証基盤の列に入らない長さは、認証基盤へ送らず、言い切りの答え(`validation_failed`)で返す。
 */

import { jsonResponse } from '@kaninabe/runtime/http/response';

/** 1 要求で許す、更新の失敗の回数。ライブラリの待ち時間で 200 + 400 + 800ms = 1.4 秒ぶんの再試行になる(`409` は再利用の猶予の中で次の試行が通る)。 */
export const REFRESH_FAILURE_LIMIT = 4;

/**
 * 1 要求で更新に使える時間(ミリ秒)。続けて失敗している間を最初の試行から数え、成功で数え直す。残りの時間は試行の打ち切りにも使う。
 * 認証基盤は自分の時間切れ(10 秒。`504 request_timeout`)まで更新の行の順番を待たせるので、それより長くする(実測: 5 秒では並列の有効な利用者が半分近く 500 になった)。
 */
export const REFRESH_TIME_LIMIT_MS = 12_000;

/** 更新トークンの長さの上限(GoTrue の `auth.refresh_tokens.token` は `varchar(255)`)。 */
export const REFRESH_TOKEN_MAX_LENGTH = 255;

/** 予算が尽きた答えの `error_code`。言い切りの閉じた表に**載せない**ので、利用者の読み分けは「読めない」になる。 */
export const REFRESH_EXHAUSTED_CODE = 'session_refresh_exhausted';

/** ライブラリが「今は答えられない」と読む状態。 */
const UNAVAILABLE_STATUS = 503;

/** 読み替える 4xx の閉じた表(5xx は別に全部読み替える)。 */
const INCONCLUSIVE_4XX: readonly number[] = [409, 429];

/** ここからの状態は全部読み替える(5xx)。 */
const SERVER_FAILURE_FROM = 500;

/** 1 要求の更新の予算。 */
export interface RefreshBudget {
  /** これまでの失敗の回数。 */
  failures: number;
  /** 最初の試行の時刻(未着手は null)。 */
  startedAt: number | null;
  /** 尽きたか。尽きたあとは認証基盤へ送らず、セッションの cookie も書かない。 */
  exhausted: boolean;
}

/**
 * 予算を作る。
 *
 * @param spent - 前段ですでに尽きた要求なら true(同じ要求の画面の読みで、もう 1 周しない)
 * @returns 新しい予算
 */
export function createRefreshBudget(spent = false): RefreshBudget {
  return { failures: 0, startedAt: null, exhausted: spent };
}

/**
 * 前段で予算が尽きたことを、同じ要求の後続の読みへ伝える要求のヘッダの名前。
 * 前段は外から来た同じ名前を必ず消す(付けられるのは前段だけ)。前段を通らない口に外から付けても、その要求が閉じるだけである。
 */
export const REFRESH_SPENT_HEADER = 'x-st-session-refresh-spent';

/**
 * 要求が更新の口か。
 *
 * @param input - 要求の宛先
 * @returns 更新の口なら true
 */
export function isRefreshRequest(input: RequestInfo | URL): boolean {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  return url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'refresh_token';
}

/** 本文の更新トークンの形が壊れているか(本文はライブラリが JSON で作る。文字列でない本文は、ここでは判断しない)。 */
function hasMalformedRefreshToken(body: RequestInit['body']): boolean {
  if (typeof body !== 'string') return false;
  const { refresh_token: token } = JSON.parse(body) as { readonly refresh_token?: unknown };
  return typeof token !== 'string' || token.length > REFRESH_TOKEN_MAX_LENGTH;
}

/** ライブラリが認証基盤の失敗と読む答え(`error_code` は版の見出しが無い応答の綴り)。 */
function failureAnswer(code: string): Response {
  return jsonResponse({ error_code: code, msg: code }, { status: 400 });
}

/** 応答がセッションの死を言い切らない形か(閉じた表)。 */
function isInconclusive(status: number): boolean {
  return status >= SERVER_FAILURE_FROM || INCONCLUSIVE_4XX.includes(status);
}

/** 残りの時間で打ち切る信号。呼び手の信号があれば両方を効かせる。 */
function attemptSignal(remainingMs: number, outer: AbortSignal | null | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(remainingMs);
  return outer === null || outer === undefined ? deadline : AbortSignal.any([outer, deadline]);
}

/**
 * 更新の口の失敗のうち、セッションの死を言い切らない答えを「今は答えられない」(503)にし、予算が尽きたら閉じた答えを返す `fetch` を作る。
 *
 * `409 conflict`(同じ更新トークンの同時の更新)と `429` が 1 回返るだけで有効な利用者がログアウトするのを防ぐ(本物の認証基盤で実測。O15-2)。503 ならライブラリは cookie を消さず、再利用の猶予の中で次の試行が通る。
 * 更新の口のほかの要求は触らない。予算が尽きた答えは 400 で、ライブラリの再試行を止める(cookie を消させない側は `createSessionClient` が持つ)。
 *
 * @param base - 下の `fetch`
 * @param budget - この要求の予算
 * @returns 読み替えた `fetch`
 */
export function unavailableUnlessSignedOut(base: typeof fetch, budget: RefreshBudget = createRefreshBudget()): typeof fetch {
  const failed = (): Response => {
    budget.failures += 1;
    const late = budget.startedAt !== null && Date.now() - budget.startedAt >= REFRESH_TIME_LIMIT_MS;
    if (budget.failures < REFRESH_FAILURE_LIMIT && !late) return new Response(null, { status: UNAVAILABLE_STATUS });
    budget.exhausted = true;
    return failureAnswer(REFRESH_EXHAUSTED_CODE);
  };
  return async (input, init) => {
    if (!isRefreshRequest(input)) return base(input, init);
    if (hasMalformedRefreshToken(init?.body)) return failureAnswer('validation_failed');
    const startedAt = budget.startedAt ?? Date.now();
    budget.startedAt = startedAt;
    const remainingMs = REFRESH_TIME_LIMIT_MS - (Date.now() - startedAt);
    if (budget.exhausted || remainingMs <= 0) {
      budget.exhausted = true;
      return failureAnswer(REFRESH_EXHAUSTED_CODE);
    }
    const signal = attemptSignal(remainingMs, init?.signal);
    // 締め切りのあとに着いた答えは使わない(信号を無視する `fetch` でも)。遅れて着いた古いセッションを cookie にしない。
    const response = await base(input, { ...init, signal }).catch(() => null);
    if (response === null || signal.aborted || isInconclusive(response.status)) return failed();
    if (response.ok) {
      budget.failures = 0;
      budget.startedAt = null;
    }
    return response;
  };
}
