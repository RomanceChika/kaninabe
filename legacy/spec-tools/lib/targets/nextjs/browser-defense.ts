/**
 * **アプリの枠の後段 Next.js のブラウザ側の守りの値**(`BrowserDefenseProfile`。型と床はコアの `lib/model/product/browser-defense.ts`)。
 *
 * 生成器(`generate/code-browser-defense.ts`)がこの値を製品の生成物へ写し、生成したリクエスト前段と、`next.config` の `headers()` が配る
 * (配線は生成テストが見張る)。製品は何も書かない —— 書き手が何もしなくても全応答に付く。
 *
 * ## 一次資料
 *
 * - Next.js の公式文書「How to set a Content Security Policy (CSP) for your Next.js application」(この版の
 *   `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`・https://nextjs.org/docs/app/guides/content-security-policy):
 *   リクエスト前段(proxy)で要求ごとに nonce を作り、要求の `Content-Security-Policy` に載せると、Next.js が描画のときに nonce を読み取って
 *   自分のスクリプトに付ける。nonce を使うページは**要求ごとに描画する**必要がある(静的に出したページには nonce を付けられない)。
 *   開発中は React がデバッグ情報のために `eval` を使うので `'unsafe-eval'` が要り、本番では要らない。
 * - 同じ文書の matcher の例: 静的な資材(`_next/static`・`_next/image`・`favicon.ico`)と Route Handler(`api`)はリクエスト前段を通さない。
 *
 * スクリプトの読み込み元(ASVS V3.4.3)と枠(V3.4.6)に加えて、`default-src` / `connect-src` / `img-src` を同じオリジンに絞る。HTML の注入が
 * 1 か所でも起きたとき、`<img src=外?…>` や `fetch` で外へ持ち出す経路を止める深層の守りである(スクリプトの nonce で注入そのものは止めている)。
 * ブラウザが直に繋ぐ外のサービス(Supabase など)を持つ製品は、`relaxations` に理由つきで origin を足す。サーバーだけが繋ぐ製品(題材)は足さない。
 *
 * **置かない指令**: `form-action` は置かない。サインインの開始は同じオリジンへのフォーム POST で、応答の 303 が認証基盤・IdP(Discord など)へ
 * 転送する。Chrome は `form-action` を転送の連鎖の各行き先にも掛けるので、`'self'` だけではログインが壊れ、IdP の origin を並べるには
 * 製品ごとの認証宣言を後段が知る必要がある(`BACKLOG`: 認証宣言から `form-action` の源を導く)。`style-src` は `default-src 'self'` が受ける
 * (題材はインラインのスタイル属性・`<style>` を出さない。出す製品は `relaxations` に理由つきで足す)。
 */

import type { BrowserDefenseProfile } from '../../model/product/browser-defense.js';

/** Next.js(アプリの枠)のブラウザ側の守り。 */
export const NEXTJS_BROWSER_DEFENSE: BrowserDefenseProfile = {
  headers: [
    // 2 年・サブドメインも HTTPS だけにする(ASVS V3.4.1。床は 1 年)。
    { name: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    // 宣言と違う種類の内容として読ませない(V3.4.4・V3.2.1)。
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    // 別のサイトへ移るとき、パスとクエリを Referer に載せない(V3.4.5)。
    { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // 他サイトの枠に載せない(古いブラウザ向け。新しいブラウザ向けは CSP の frame-ancestors。V3.4.6)。
    { name: 'X-Frame-Options', value: 'DENY' },
    // 使わない機能(カメラ・マイク・位置情報)を許さない。
    { name: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ],
  csp: {
    directives: [
      // 指令を書かなかった種類(font・media・worker・manifest など)の読み込み元を、同じオリジンに限る(深層の守り。ASVS V3.4.3 の外の層)。
      { name: 'default-src', sources: ["'self'"] },
      { name: 'script-src', sources: ["'strict-dynamic'"] },
      // fetch・XHR・WebSocket の行き先。ブラウザが直に繋ぐ外のサービスを持つ製品は、`relaxations` に理由つきでその origin を足す。
      { name: 'connect-src', sources: ["'self'"] },
      // 画像の読み込み元。外の画像は `relaxations` に理由つきで足す(`data:` はインラインの小さな画像のために許す)。
      { name: 'img-src', sources: ["'self'", 'data:'] },
      { name: 'object-src', sources: ["'none'"] },
      { name: 'base-uri', sources: ["'none'"] },
      { name: 'frame-ancestors', sources: ["'none'"] },
    ],
    nonceDirectives: ['script-src'],
    development: [
      {
        name: 'script-src',
        sources: ["'unsafe-eval'"],
        reason:
          'Next.js の公式文書(Content Security Policy の Development の節): 開発中は React がデバッグ情報(サーバーのエラーのスタックの復元)に eval を使う。本番では React も Next.js も eval を使わない',
      },
    ],
  },
  noStore: { name: 'Cache-Control', value: 'no-store' },
  clearSiteData: { name: 'Clear-Site-Data', value: '"cache", "cookies", "storage"' },
  relaxations: [],
  gateExcludedPrefixes: ['api/', '_next/static/', '_next/image/', 'favicon.ico'],
};
