import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * 単体(`vitest.config.ts`)と統合(`vitest.integration.config.ts`)の設定が共有する**モジュール解決**。
 * 別々に書くと、片方の設定でだけ実行時パッケージの入口が読めない、が起きる。
 */

/**
 * サーバー専用マーカー(`server-only`)の**空の実体**。実行時パッケージの一部の入口(例: 拒否の分類の語)は
 * 製品のクライアントバンドルへの混入を防ぐためにこれを import しており、Node で素のまま読むと例外を投げる。
 * テストでは空の実体に差し替える(製品の vitest 設定と同じ。`node_modules` の中の綴りは持たず、解決に任せる)。
 */
const SERVER_ONLY_EMPTY = path.join(path.dirname(createRequire(import.meta.url).resolve('server-only')), 'empty.js');

/** 実行時パッケージの `exports` を解く条件。`test` を先頭に置くとソースを読む。 */
const CONDITIONS = ['test', 'module', 'node', 'development|production'];

/**
 * vitest の `resolve` / `ssr` の設定。
 *
 * 実行時パッケージは**配布物ではなくソース**を読む(`exports` の `test` 条件。製品の vitest 設定と同じ)。
 * 配布物(CommonJS)の `require('server-only')` は vite の alias を通らないので、サーバー専用マーカーを持つ入口が
 * 素のまま例外を投げる。`vue` は 1 本に畳む(ブックの部品が自分の側から読む Vue と、描画器の Vue を揃える)。
 */
export const RESOLVE_SETTINGS = {
  resolve: { conditions: CONDITIONS, alias: { 'server-only': SERVER_ONLY_EMPTY } },
  ssr: { resolve: { conditions: CONDITIONS } },
} as const;
