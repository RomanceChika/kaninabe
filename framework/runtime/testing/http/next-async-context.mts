import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * ユニットテストの setupFiles に置く 1 行: Next.js の内部モジュールが読む `globalThis.AsyncLocalStorage` を注入する。
 *
 * Next.js の要求単位の API(`cookies()` / `headers()`)は、`next/dist/server/app-render/async-local-storage.js` が**読み込まれた時点**の
 * `globalThis.AsyncLocalStorage` を掴む(無ければ常に「文脈が無い」を返すフェイクの実装を使う)。Node の vitest にはこのグローバルが無いので、
 * テストファイル自身の import より先に評価される setupFiles で 1 度だけ注入する(統合テストの `../local/setup-env.mts` と同じ 1 行。
 * こちらはローカルの DB に触れないので、ユニットテストに置ける)。既定で未設定のグローバルに Node 本来の実装を入れるだけで、ほかのテストの挙動は変えない。
 *
 * 使うのは有料の口の関門の見張りテスト(`./paid-gate.mts` の `runInNextRequestContext`)である。
 */
(globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
