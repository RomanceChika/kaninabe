/**
 * 認証フロー仕様の `sessions`(セッションの寿命)の宣言の型と、期間の書き方の読み方。
 *
 * 使い手は 3 つある: パーサー(`parse-auth-sessions.ts`。H0 が宣言の形を見る)・プラットフォームの後段の H5
 * (設定の値を宣言に突き合わせる。設定の側の期間の綴りは後段が読み、比べるのは秒の数)・文書の生成(宣言を表に出す)。
 * どれも「何秒か」で比べるので、宣言の綴り(`8h` / `1d12h`)を秒に直す関数をここに 1 つだけ置く。
 *
 * 語は中立である(無操作の時間切れ・絶対の寿命)。プラットフォームの設定のどのキーに当たるかは後段が決める。
 */

import type { SourceLocation } from '../types.js';

/** 上限に達したときの挙動(`ends_oldest` = いちばん古いセッションを終えて新しいのを通す / `refuses_new` = 新しいサインインを断る)。 */
export const CONCURRENT_ON_LIMIT = ['ends_oldest', 'refuses_new'] as const;
export type ConcurrentOnLimit = (typeof CONCURRENT_ON_LIMIT)[number];

/**
 * 同時に持てるセッションの数の宣言(`sessions.concurrent`)。どちらの形も理由が要る(空不可)。
 *
 * - `unbounded` … 上限を置かない(プラットフォームの既定)。置かない理由を書く
 * - `limited` … 1 人が同時に持てる数の上限 `max`(1 以上の整数)と、上限に達したときの挙動 `onLimit`
 */
export type ConcurrentSessionsDecl =
  | { readonly kind: 'unbounded'; readonly reason: string }
  | { readonly kind: 'limited'; readonly max: number; readonly onLimit: ConcurrentOnLimit; readonly reason: string };

/** 同時セッションの宣言を人が読む言い方にする(文書・指摘・実行ログで共通)。 */
export function concurrentWords(concurrent: ConcurrentSessionsDecl): string {
  if (concurrent.kind === 'unbounded') return '上限なし';
  return `1 人 ${concurrent.max} 件まで(上限に達したら${concurrent.onLimit === 'ends_oldest' ? 'いちばん古いセッションを終える' : '新しいサインインを断る'})`;
}

/**
 * セッションの寿命の宣言(`sessions`)。必須(書かなければ H0 が止める —— 書かないとセッションが時間で終わらない既定のまま出荷される)。
 *
 * - `inactivity` … 無操作の時間切れ。最後にセッションを使った(更新した)ときから、この時間が過ぎたら再認証を求める
 * - `absolute` … 絶対の寿命。サインインしたときから、この時間が過ぎたら、使い続けていても再認証を求める。
 *   更新トークンも、この時点でセッションごと使えなくなる(更新トークンの絶対の期限を兼ねる)
 * - `reason` … この値にした理由(空不可)。値そのものより、なぜその値かが文書になる
 * - `concurrent` … 同時に持てるセッションの数と、上限に達したときの挙動(必須。上限なしなら `unbounded` と理由)
 */
export interface AuthSessionsDecl {
  /** 無操作の時間切れ(宣言の綴りのまま。例: `8h`)。 */
  readonly inactivity: string;
  /** 無操作の時間切れの秒数。 */
  readonly inactivitySeconds: number;
  /** 絶対の寿命(宣言の綴りのまま。例: `24h`)。 */
  readonly absolute: string;
  /** 絶対の寿命の秒数。 */
  readonly absoluteSeconds: number;
  /** この値にした理由。 */
  readonly reason: string;
  /** 同時に持てるセッションの数の宣言。 */
  readonly concurrent: ConcurrentSessionsDecl;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 宣言の期間の綴り(日・時間・分を大きい順に 1 つ以上。例: `30m` / `8h` / `1d12h`)。 */
const DECLARED_DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;

/** 単位ごとの秒数(日・時間・分)。 */
const UNIT_SECONDS: readonly number[] = [86_400, 3_600, 60];

/**
 * 宣言の期間の綴りを秒に直す。
 *
 * @param text 宣言の綴り(`d` / `h` / `m` を大きい順に。空・0・ほかの書き方は読めない)
 * @returns 秒数(読めない・0 なら null)
 */
export function declaredDurationSeconds(text: string): number | null {
  const match = DECLARED_DURATION.exec(text);
  if (match === null) return null;
  const parts = match.slice(1, 4);
  if (parts.every((part) => part === undefined)) return null;
  const seconds = parts.reduce((total, part, index) => total + (part === undefined ? 0 : Number(part) * (UNIT_SECONDS[index] ?? 0)), 0);
  return seconds > 0 ? seconds : null;
}

/**
 * 秒数を人が読む綴りにする(`8h` / `1h30m` / `45s`)。指摘の文に設定の値と宣言の値を並べるときに使う。
 *
 * @param seconds 秒数(0 以上)
 */
export function formatSeconds(seconds: number): string {
  const units: readonly (readonly [string, number])[] = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
  ];
  let rest = seconds;
  let text = '';
  for (const [unit, size] of units) {
    const count = Math.floor(rest / size);
    if (count > 0) text += `${count}${unit}`;
    rest -= count * size;
  }
  if (rest > 0 || text === '') text += `${Number(rest.toFixed(3))}s`;
  return text;
}
