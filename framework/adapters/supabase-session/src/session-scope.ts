/**
 * **1 要求の段のセッションの台帳**: 更新の世代と、cookie の書き込みの世代の比べ。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-3(締め出しの連鎖。点検 17〜19 回目の測り)
 *
 * 締め出しは次の連鎖で起きた(GoTrue の `JWT_EXP=3`・10 並列で 50 回中 6 回。12 件とも同じ形)。
 *
 * 1. 前段(`proxy`)が更新して、1 世代進めた cookie を応答に載せる。
 * 2. 同じ要求の描画(RSC)が、その cookie を**もう一度**更新する。アクセストークンの寿命がライブラリの更新の余裕(90 秒)より短いと、
 *    読みのたびに更新が走る。RSC は cookie を書けないので、進めた世代はどこにも残らない。
 * 3. 応答が 10 秒の再利用の猶予より遅れて着くと、ブラウザは 2 世代前の更新トークンを持つ。次の要求は `refresh_token_already_used` で、
 *    認証基盤はセッションの系列ごと失効させる。
 *
 * ここは次の 2 つを持つ。
 *
 * - **段の種類**(`stage`): 前段(`front`)だけが、期限の手前の更新(ライブラリの余裕による前倒し)をしてよい。後段(`downstream`。
 *   描画・Server Action・Route Handler)は、要求の cookie のアクセストークンが**本当に**生きている間は更新しない
 *   (同じ要求の更新は前段の 1 回に寄せる)。本当に切れたときだけ更新する。
 * - **世代**: 段の中で受け取ったセッションに、受け取った順の番号を振る(要求の cookie が 0)。cookie の書き込みは、
 *   最後に書いた世代より**新しい**ものだけを通す。古い世代・要求の cookie そのものの書き戻しは捨てる。
 */

import { stringFromBase64URL } from '@supabase/ssr';
import { SESSION_COOKIE_NAME } from './cookie-policy';
import type { CookieWrite } from './cookie-policy';
import { createRefreshBudget } from './refresh-guard';
import type { RefreshBudget } from './refresh-guard';

/** 生きているとみなすのに要る、アクセストークンの残り(ミリ秒)。これより短ければ切れたとみなす(1 回の読みの往復に足りる幅)。 */
export const ACCESS_TOKEN_SKEW_MS = 1_000;

/** 段の種類。`front` = 要求の前段(期限の手前の更新をしてよい)・`downstream` = 後段(本当に切れたときだけ更新する)。 */
export type SessionStage = 'front' | 'downstream';

/** 更新で受け取ったセッション 1 つ(認証基盤の答えの本文と、その読み)。 */
export interface SessionSnapshot {
  /** 答えの本文(JSON)。同じ答えを別の呼び手へ渡すときに作り直す。 */
  readonly body: string;
  /** このセッションの更新トークン。 */
  readonly refreshToken: string;
  /** アクセストークンの期限(エポックからのミリ秒)。 */
  readonly expiresAtMs: number;
}

/** 認証基盤の答え(本文まで読み切ったもの)。段の中で待っている呼び手に同じ答えを配る。 */
export interface RefreshOutcome {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** 1 要求の段の台帳。 */
export interface SessionScope {
  readonly stage: SessionStage;
  readonly budget: RefreshBudget;
  /** 段の中でいちばん新しいセッションとその世代(まだ無ければ null)。 */
  head: { readonly snapshot: SessionSnapshot; readonly generation: number } | null;
  /** 段が知っている更新トークン → 世代。 */
  readonly generations: Map<string, number>;
  /** 最後に振った世代。 */
  issued: number;
  /** 最後に書いた cookie の世代(要求の cookie が 0)。 */
  written: number;
  /** 段の中で走っている更新(更新トークン → 答え。null は届かなかった)。 */
  readonly pending: Map<string, Promise<RefreshOutcome | null>>;
}

/** 台帳を作るときの指定。 */
export interface SessionScopeOptions {
  readonly stage?: SessionStage;
  /** 予算を共有するとき(省略は新しい予算)。 */
  readonly budget?: RefreshBudget;
}

/**
 * 台帳を作る。
 *
 * @param options - 段の種類と予算
 * @returns 新しい台帳(省略は前段の形 = これまでと同じ振る舞い)
 */
export function createSessionScope(options: SessionScopeOptions = {}): SessionScope {
  return { stage: options.stage ?? 'front', budget: options.budget ?? createRefreshBudget(), head: null, generations: new Map(), issued: 0, written: 0, pending: new Map() };
}

/**
 * アクセストークンが、いまから `ACCESS_TOKEN_SKEW_MS` より先まで生きているか。
 *
 * @param snapshot - セッション
 * @param now - いま(ミリ秒)
 * @returns 生きていれば true
 */
export function isFresh(snapshot: SessionSnapshot, now: number = Date.now()): boolean {
  return snapshot.expiresAtMs - now > ACCESS_TOKEN_SKEW_MS;
}

/**
 * 認証基盤の答えの本文(またはセッションの cookie の JSON)をセッションとして読む。形が合わなければ null。
 *
 * @param body - JSON の文字列
 * @returns セッション
 */
export function snapshotOf(body: string): SessionSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { refresh_token: refreshToken, access_token: accessToken, expires_at: expiresAt } = parsed as Record<string, unknown>;
  if (typeof refreshToken !== 'string' || refreshToken === '' || typeof accessToken !== 'string' || typeof expiresAt !== 'number') return null;
  return { body, refreshToken, expiresAtMs: expiresAt * 1000 };
}

/** ライブラリが書くセッションの cookie の値の接頭辞(`base64-` + base64url(JSON))。 */
const BASE64_PREFIX = 'base64-';

/** セッションの本体か、その分割(`.0` `.1` …)の名前か。検証子(`-code-verifier`)は含めない。 */
function chunkIndexOf(name: string): number | null {
  if (name === SESSION_COOKIE_NAME) return -1;
  const match = /^(.*)\.(0|[1-9]\d*)$/.exec(name);
  return match?.[1] === SESSION_COOKIE_NAME ? Number(match[2]) : null;
}

/**
 * cookie の並びから、セッションの値をつなぐ(本体があれば本体、無ければ `.0` から続く分割)。値の無いものは無いものとして扱う。
 *
 * @param cookies - 名前と値
 * @returns つないだ値(無ければ null)
 */
export function sessionCookieValueOf(cookies: readonly { readonly name: string; readonly value: string }[]): string | null {
  const parts = new Map<number, string>();
  for (const { name, value } of cookies) {
    const index = chunkIndexOf(name);
    if (index !== null && value !== '') parts.set(index, value);
  }
  const whole = parts.get(-1);
  if (whole !== undefined) return whole;
  let joined = '';
  for (let index = 0; parts.has(index); index += 1) joined += parts.get(index);
  return joined === '' ? null : joined;
}

/**
 * セッションの cookie の値をセッションとして読む(`base64-` の形だけ。ほかの形・壊れた形は null)。
 *
 * @param value - つないだ cookie の値
 * @returns セッション
 */
export function snapshotOfCookieValue(value: string | null): SessionSnapshot | null {
  if (value?.startsWith(BASE64_PREFIX) !== true) return null;
  try {
    return snapshotOf(stringFromBase64URL(value.slice(BASE64_PREFIX.length)));
  } catch {
    return null;
  }
}

/**
 * 段が受け取ったセッションを、いちばん新しい世代として記録する。更新に出したトークン(`from`)も世代に載せる。
 *
 * @param scope - 台帳
 * @param from - 更新に出したトークン
 * @param snapshot - 受け取ったセッション
 */
export function recordHead(scope: SessionScope, from: string, snapshot: SessionSnapshot): void {
  if (!scope.generations.has(from)) scope.generations.set(from, 0);
  const known = scope.generations.get(snapshot.refreshToken);
  if (known !== undefined && scope.head !== null && known <= scope.head.generation) return;
  scope.issued += 1;
  scope.generations.set(snapshot.refreshToken, scope.issued);
  scope.head = { snapshot, generation: scope.issued };
}

/**
 * 要求の cookie のセッションを、段のいちばん新しいセッション(世代 0。更新していない)として採る。
 *
 * @param scope - 台帳
 * @param snapshot - 要求の cookie のセッション
 */
export function adoptRequestSession(scope: SessionScope, snapshot: SessionSnapshot): void {
  scope.generations.set(snapshot.refreshToken, 0);
  scope.head = { snapshot, generation: 0 };
}

/**
 * 書き込みの束のうちセッションの cookie の世代(消去だけの束・セッションを含まない束は null)。知らないトークン(サインインの交換など)は新しい世代を振る。
 *
 * @param scope - 台帳
 * @param writes - 書き込みの束
 * @returns 世代
 */
function generationOfWrites(scope: SessionScope, writes: readonly CookieWrite[]): number | null {
  const snapshot = snapshotOfCookieValue(sessionCookieValueOf(writes.filter((write) => write.options.maxAge !== 0)));
  if (snapshot === null) return null;
  const known = scope.generations.get(snapshot.refreshToken);
  if (known !== undefined) return known;
  scope.issued += 1;
  scope.generations.set(snapshot.refreshToken, scope.issued);
  return scope.issued;
}

/**
 * 書き込みの束を世代で比べ、通す分だけを返す。**最後に書いた世代より新しいセッションだけが勝つ**。古い世代と、要求の cookie(世代 0)の
 * 書き戻しは、セッションの cookie の分を捨てる(検証子・移行前の名前の消去など、セッションの系列でない書き込みはそのまま通す)。
 * 消去だけの束は通す(認証基盤がセッションの死を言い切ったときにだけ来る)。
 *
 * @param scope - 台帳
 * @param writes - ライブラリが書こうとした束
 * @returns 書き手へ渡す束
 */
export function admitWrites(scope: SessionScope, writes: readonly CookieWrite[]): CookieWrite[] {
  const generation = generationOfWrites(scope, writes);
  if (generation === null) return [...writes];
  if (generation <= scope.written) return writes.filter((write) => chunkIndexOf(write.name) === null);
  scope.written = generation;
  return [...writes];
}
