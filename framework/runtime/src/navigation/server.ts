/**
 * **サーバー側(Server Component・Server Action)の転送を作る唯一の部品**(ASVS V3.7.2。点検 9 回目 B9-1〜B9-6)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md §転送は安全な部品だけ
 *
 * 製品のコードは `next/navigation` の `redirect` / `permanentRedirect` を引けない(ESLint の `layer/require-safe-redirect` が
 * import・名前空間の参照・再 export の全部を止める)。転送はここから呼び、行き先は核の {@link safeReturnPathOr}
 * (同じオリジンの相対パスだけ)を必ず通る —— 字句・生成した経路(`screenPath(…)`)・利用者の値(`?next=`)のどれを
 * 渡しても、外のオリジンへは出ない。静的な形の見分け(どの式なら安全か)に頼らないので、規則の検査の漏れ(自前のフックの
 * 別名・名前空間・字句の頭の制御文字)が開いた転送にならない。
 */

import { permanentRedirect, redirect } from 'next/navigation';
import { safeReturnPathOr } from '../domain/url.js';

/** サーバー側の転送の組み方。 */
export interface SafeRedirectOptions {
  /** 行き先が通らないときの行き先(書いた人が決める同じオリジンの相対パス。既定は `'/'`)。 */
  readonly fallback?: string;
  /** 恒久の転送(308。`permanentRedirect`)にするか(既定は一時の転送)。 */
  readonly permanent?: boolean;
}

/**
 * 同じオリジンの相対パスへ転送する(例外を投げて戻らない。`redirect` と同じ)。
 *
 * @param path - 行き先の候補(利用者の値でも、生成した経路でもよい。通らなければ `fallback`)
 * @param options - 既定の行き先・恒久の転送か
 * @returns 戻らない
 * @throws 転送の合図(Next.js が受け取る)。`fallback` が同じオリジンの相対パスでないときは `Error`
 */
export function safeRedirect(path: string | null | undefined, options: SafeRedirectOptions = {}): never {
  const target = safeReturnPathOr(path, options.fallback);
  return options.permanent === true ? permanentRedirect(target) : redirect(target);
}
