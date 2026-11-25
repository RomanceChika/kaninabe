/**
 * **外の URL を呼ぶ `fetch`**(ASVS V15.3.2。意図しない転送について行かない)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md
 *
 * グローバルの `fetch` は既定で `redirect: "follow"` —— 呼び先が 3xx を返すと、**宣言していない別の行き先**へ
 * (しかも `Authorization` などを付けたまま、または付け替えて)黙ってついて行く。外へ送る口(外部連携のアダプタ・
 * 認証基盤・AI の SDK)は **すべてこの `safeFetch` を通す**。転送は `redirect: "error"` で**失敗**にする
 * (`TypeError`。呼び出し側の「送れなかった」の経路に落ちる)。
 *
 * - `redirect` は**呼び出し側から変えられない**(型に無く、実行時に渡されても `"error"` に決め直す)。転送を意図して
 *   辿る口が要るなら、それは設計として別に決める(`"manual"` で `Location` を検査して辿る部品を足す。いまは要る口が無い)
 * - `Request` を渡した場合も、その `redirect` より `init.redirect` が勝つので `"error"` になる
 * - **枠のデータのキャッシュに載せない**(点検 12 回目 B12-2): Next.js が差し込む `fetch` は `cache: 'force-cache'` / `next: { revalidate }` で、配備全体で共有する
 *   保存に応答を残す。鍵は URL と本文などで、実行者を知らない。どちらも型に無く、実行時も `cache` は `"no-store"` に決め直し、`next` は渡さない
 * - 実行時の `globalThis.fetch` は**呼ぶたびに引く**(Next.js が差し込む `fetch`・テストの差し替えに効く)
 *
 * グローバルの `fetch` を直接使うことは lint(`layer/require-safe-fetch`)が止める。この部品だけがグローバルを引く。
 */

/** `safeFetch` の第 2 引数(`redirect` と、枠のデータのキャッシュの `cache` / `next` は決められない)。 */
export type SafeFetchInit = Omit<RequestInit, 'redirect' | 'cache' | 'next'>;

/**
 * 転送について行かない `fetch`。
 *
 * @param input - URL または `Request`
 * @param init - `fetch` の第 2 引数(`redirect` は無視して `"error"`、`cache` は無視して `"no-store"` にし、`next` は渡さない)
 * @returns 応答。呼び先が 3xx を返したときは `TypeError` で失敗する
 */
export function safeFetch(input: RequestInfo | URL, init?: SafeFetchInit): Promise<Response> {
  return globalThis.fetch(input, { ...init, next: undefined, redirect: 'error', cache: 'no-store' } as RequestInit);
}
