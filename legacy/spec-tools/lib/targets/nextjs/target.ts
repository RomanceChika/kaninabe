/**
 * **アプリの枠の後段 Next.js**(`role: app_frame`)。置き場の役割 → パスの値(`ProductLayout`)と、ブラウザ側の守りの宣言(`BrowserDefenseProfile`)を与え、
 * 守りを製品の実装の木へ配る生成器を登録する:
 *
 *   - `code-browser-defense` … 宣言の値(`{生成物の置き場}/browser-defense.ts`)とリクエスト前段(`proxy.ts`。文書の CSP・要求の出どころ・セッションの更新)
 *   - `code-browser-defense-tests` … 配線の見張りテスト(枠の設定の `headers()`・リクエスト前段・cookie で認証する口・要求ごとの描画)
 *   - `code-paid-entry-tests` … 有料の口の関門の見張りテスト(未ログイン 401・役なし 403 を実物の口で叩く)
 *
 * ログアウトの口(認証フロー仕様の `logout`)は生成しない —— セッションを閉じるのは認証基盤の adapter の仕事で、製品が手で書く口が
 * adapter を呼ぶ(サインインの開始の口 `start` と同じ。ブラウザは認証基盤に直接つながない。server-only-session.md)。
 *
 * 検査は登録しない(Server Action・画面・Route Handler の生成器は、移すかたまりごとにこの後段へ寄せる。設計メモ framework-modules §20-2 の順 P2〜P6)。
 * この値を選んで配置を配るのは組み立ての根(`cli/select-targets.ts`)だけで、コアはこの後段の名前を知らない。アプリの枠を別のものに替える日は、
 * この置き場と同じ役割の宣言を持つ後段を足して選び直す。
 */

import type { Target } from '../../target-api/contract.js';
import { NEXTJS_BROWSER_DEFENSE } from './browser-defense.js';
import { browserDefenseGenerator } from './generate/code-browser-defense.js';
import { browserDefenseTestsGenerator } from './generate/code-browser-defense-tests.js';
import { paidEntryTestsGenerator } from './generate/code-paid-entry-tests.js';
import { NEXTJS_LAYOUT } from './layout.js';

/** Next.js(アプリの枠)の後段。 */
export const NEXTJS_TARGET: Target = {
  id: 'nextjs',
  role: 'app_frame',
  verifiers: [],
  generators: [browserDefenseGenerator, browserDefenseTestsGenerator, paidEntryTestsGenerator],
  layout: NEXTJS_LAYOUT,
  browserDefense: NEXTJS_BROWSER_DEFENSE,
};
