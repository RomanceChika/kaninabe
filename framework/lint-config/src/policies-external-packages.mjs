/**
 * 層ごとに値として import してよい外部パッケージの許可表(`policies-boundaries.mjs` の `BOUNDARY_POLICIES` が読む)。
 * 表の綴りと根拠だけをここに置き、どの層にどの表を当てるかは `BOUNDARY_POLICIES` が持つ。
 */

/**
 * **層ごとに import してよい外部パッケージの許可表**(点検 8 回目 B8-1)。
 *
 * 外部の SDK・サービスのパッケージ(AI の SDK・Supabase のクライアント・決済や送信の SDK)は、
 * アダプタの置き場である infrastructure の下でだけ import できる。以前は `src/app` と `composition` に
 * 外部パッケージの全部を許していたので、SDK の入門どおりにページや Composition から直に呼ぶと、
 * 有料の連携の宣言した口(`runPaidEntry`)・認可・枠・`safeFetch`・無害化の全部を通らずに外へ出られた
 * (X8 は「アダプタのファイルに届くか」で見るので黙る)。表に無いパッケージは既定の disallow で落ちる。
 *
 * 表の根拠(足すときは同じ形で理由を書く。SDK を足すのではなく、SDK を包んだアダプタを infrastructure に置く):
 *   - `next` / `react` / `react-dom`(と各々の下位パス): 画面と枠の基盤そのもの。外への口を持たない
 *     (`next` の `fetch` の拡張はグローバルの `fetch` で、`layer/no-external-network` が見る)。
 *   - `zod`: 入力の形の宣言(全層の共通語)。
 *   - `server-only`: サーバー専用の印(副作用の import だけ)。
 * 仕組みの部品(`@kaninabe/runtime` / `@kaninabe/adapter-*`)は外部パッケージではなく**要素**として層ごとに許す
 * (`runtime-elements.mjs`。解決先がリポジトリの中なので要素の照合が先に確定する)。
 * 型だけの import(`import type`)は実行時に何も呼ばないので、外部パッケージの全部を許す(下の 1 行)。
 */
export const UI_FOUNDATION_PACKAGES = Object.freeze(["next", "next/**", "react", "react/**", "react-dom", "react-dom/**"]);

/** 画面の層(`src/app`・画面の部品の生成物・components)が値として import してよい外部パッケージ。 */
export const UI_LAYER_EXTERNAL_PACKAGES = Object.freeze([...UI_FOUNDATION_PACKAGES, "zod", "server-only"]);

/** composition(配線)が値として import してよい外部パッケージ(画面を描かないが、`next/headers` などの要求の文脈と `react` の `cache` を使う)。 */
export const COMPOSITION_EXTERNAL_PACKAGES = Object.freeze([...UI_FOUNDATION_PACKAGES, "zod", "server-only"]);

/**
 * 基盤の層(infrastructure)が**どのディレクトリでも**値として import してよい外部パッケージ(点検 9 回目 B9-4)。
 *
 * 以前は infrastructure に外部パッケージの全部を許していたので、SDK の呼び出しを集約名のディレクトリ(`infrastructure/{集約}/`)に
 * 置くと、X1 も X8 も ESLint も見ず、有料の連携の関門を通らずに外へ出られた。いまは枠の基盤だけを許し、外部の SDK は
 * 宣言した置き場(外部連携の `adapter_root`・土台)の分類からだけ許す(生成物 `sdk-homes.json` を `sdkHomeBoundaries` が読む)。
 * 綴りは置き場の配置の `foundationPackages`(生成物 `framework-structure.json`)と同じで、一致は製品のテストが見る。
 */
export const INFRASTRUCTURE_EXTERNAL_PACKAGES = Object.freeze([...UI_FOUNDATION_PACKAGES, "zod", "server-only"]);

// 自サイトの口とだけ話すクライアントの部品が引ける SDK の UI 部品(以前の `SDK_CLIENT_UI_PACKAGES`)は、仕様の宣言
// (external_spec の `client_ui`)から生成した表 `sdk-homes.json` を `sdkHomeBoundaries`(policies-sdk-homes.mjs)が読む形に移した(B9-4)。
