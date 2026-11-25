/**
 * 仕組み側のパッケージ（`framework/**`）自身を lint する設定。
 *
 * **なぜ別に要るのか。** ESLint のフラット config は**config ファイルのあるディレクトリの外を
 * lint しない**（実測: `File ignored because outside of base path`）。したがって
 * `app/eslint.config.mjs` は `framework/` を構造的に見られず、パッケージへ移した実行時コードが
 * 境界 137 ルールの検査の範囲から静かに落ちる。ここが各パッケージの `eslint.config.mjs` が読む 1 本で
 * あり、**規則の正はこのファイルだけ**である（各パッケージに写しを持たない。設計メモ
 * `docs/design/runtime-package.md` §9-3 の案 iii）。
 *
 * **何を課すか。** 製品コードと同じ「手で書いたコードの品質規則」である —— 300 行を超えるファイルの
 * 宣言（`layer/declared-oversize`。300 行は信号であり上限ではない）・
 * 大きさの規則 3 つ（`max-lines-per-function` 180 / `max-depth` 4 / `max-params` 7）・
 * 禁止構文（`RESTRICTED_SYNTAX`。`vi.mock` 等のモジュール差し替えと `role: globalRole(...)`）・
 * 公開シンボルの JSDoc・`eslint-disable` の禁止。
 * 大きさの規則と禁止構文は束 ①-b-b で足した —— 製品の `SRC_FILES` に掛かっていてパッケージに
 * 掛かっていない規則が 4 系統あり、**ラチェットがパッケージ側で効かない**形になっていた
 * （とくに `vi.mock` 禁止はパッケージのテスト 8 本が対象外になっていた）。
 *
 * **課さないものを 2 つ明示する。**
 *   - 層境界（B1〜B10）: `framework/` に集約は無い（層の**割り当て**は製品の `src/` の形である）。
 *   - サーバー専用の宣言（S1。`import "server-only"`）: ③-e2D で**仕組み側のパッケージは印を持たなくなった**。
 *     印を持つのは製品の配線（`db-ports.ts`）と生成した組み立ての根で、runtime（拒否の分類・受信口・実行器）と
 *     adapter は Web 標準と Node の標準だけで書かれ、DB への接続そのものを持たない（接続は製品が渡す）。
 *     クライアントの部品からの混入は、製品の lint の層境界（B8。adapter と runtime の infrastructure 側は
 *     製品の infrastructure / composition だけが引ける）が止める。
 *   - `throw` の禁止: 正は scripts-code-quality.md の「**生成器**は throw しない」であり、
 *     執行範囲も docs 側の `lib/generate/**` と `lib/diff/**` に限られている。ここに生成器は
 *     住んでいない。実行時のコードは「型検査を迂回して渡された値」のような**プログラムの
 *     誤り**を投げてよい（`engine/machine.ts` の `transitionOf` が `@throws` で宣言している
 *     とおり）。範囲を広げるのは規則の流用であって、執行の強化ではない。
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";
import { PROCESS_ENV_SELECTORS, RESTRICTED_SYNTAX } from "./policies-syntax.mjs";
import { createFrameworkLayerPlugin } from "./rules/index.mjs";
import { FRAMEWORK_MODULE_STATE_ROWS } from "./rules/module-state-table.mjs";
import { SAFE_REDIRECT_PARTS } from "./rules/require-safe-redirect.mjs";

/** JSDoc を要求する型宣言の文脈（製品側と同じ 3 つ）。 */
const DOCUMENTED_CONTEXTS = [
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
];

/**
 * 仕組み側のソース。**ディレクトリを列挙せず、パッケージの根で指す。**
 *
 * 列挙していたあいだ(`src/**` と `testing/**` だけ)、束 ①-c-b が足した `scripts/**` の 177 行が
 * **検査の範囲外に落ちていた** —— `--print-config` が rules 0 件を返し、JSDoc も 300 行上限も
 * `no-restricted-syntax` も掛かっていなかった(レビューがわざと壊す確認で実測)。「検査の母集合を列挙で
 * 持つと、あとから生えたものが黙って外に出る」という、この束が W1 について直したのと同じ形である。
 *
 * 拡張子も列挙しない(`.ts` / `.tsx` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs`)。除くのは
 * `ignores` の 3 つ(パッケージの根の `node_modules` / `dist` / `coverage`。**名前でなくパス**なので、`src/dist/x.ts` は見る。点検 14 回目 C14-1)だけで、**config の入口
 * (`eslint.config.mjs` / `vitest.config.mts`)も検査の範囲内に入る** —— あれも手で書くコードである。
 */
const FRAMEWORK_FILES = ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

/** テスト本体（行数上限と JSDoc 必須の対象外。製品側と同じ線）。 */
const FRAMEWORK_TEST_FILES = ["src/**/*.test.ts", "src/**/__tests__/**"];

/**
 * 設定を当てるパッケージの根(設定ファイルの置き場)から、転送の規則の例外にするファイル(そのパッケージの行だけ)を求める。
 * 行の `package` は**リポジトリルートからのパッケージの根**で、置き場の末尾がそれに一致する行だけを取る(点検 10 回目 B10-6。
 * ファイル名だけで免除すると、別のパッケージの同じ相対パスのファイルまで規則の外になった)。置き場を渡さない呼び手は例外が無い。
 *
 * @param {string | URL | undefined} configUrl - パッケージの `eslint.config.mjs` の `import.meta.url`
 * @param {readonly { package: string, file: string }[]} parts - 例外の表(`SAFE_REDIRECT_PARTS`)
 * @returns {string[]} そのパッケージの根からの相対パス
 */
export function safeRedirectExemptions(configUrl, parts = SAFE_REDIRECT_PARTS) {
  if (configUrl === undefined) return [];
  const root = dirname(fileURLToPath(configUrl)).split("\\").join("/");
  return parts.filter((part) => root === part.package || root.endsWith(`/${part.package}`)).map((part) => part.file);
}

/**
 * 設定を当てるパッケージの根から、`layer/no-module-state` の行(そのパッケージの行だけ。`file` は絶対パス)を求める。
 *
 * @param {string | URL | undefined} configUrl - パッケージの `eslint.config.mjs` の `import.meta.url`
 * @param {readonly { package: string, file: string, name: string, why: string }[]} rows - 行の表
 * @returns {{ file: string, name: string, why: string }[]} 規則の `allow` に渡す行
 */
export function moduleStateRows(configUrl, rows = FRAMEWORK_MODULE_STATE_ROWS) {
  if (configUrl === undefined) return [];
  const root = dirname(fileURLToPath(configUrl));
  const posix = root.split("\\").join("/");
  return rows
    .filter((row) => posix === row.package || posix.endsWith(`/${row.package}`))
    .map((row) => ({ file: join(root, row.file), name: row.name, why: row.why }));
}

/**
 * **サーバーのモジュールの最上位に可変の値を置かない**(`layer/no-module-state`。点検 13 回目 B13-2)のブロック。実行時に要求を受ける `src` に掛ける。例外は表の行だけ。
 * 検査の道具 `@kaninabe/lint-config` の表(`src/*.mjs`・`src/rules/**`)は要求を受けないので外す。
 *
 * @param {object} layer - 規則のプラグイン
 * @param {string | URL | undefined} configUrl - パッケージの `eslint.config.mjs` の `import.meta.url`
 * @returns ESLint のフラット config の 1 ブロック
 */
function moduleStateBlock(layer, configUrl) {
  return {
    files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    ignores: [...FRAMEWORK_TEST_FILES, "src/*.mjs", "src/rules/**"],
    plugins: { layer },
    rules: { "layer/no-module-state": ["error", { allow: moduleStateRows(configUrl) }] },
  };
}

/**
 * 仕組み側のパッケージ 1 つぶんの設定を組む。
 *
 * @param {string | URL} [configUrl] - パッケージの `eslint.config.mjs` の `import.meta.url`(転送の規則の例外を、そのパッケージの行だけに絞る)
 * @returns ESLint のフラット config の配列
 */
export function frameworkSourceConfig(configUrl) {
  // プラグインは 1 つだけ作って両方のブロックで**同じ参照**を渡す。作り直すと
  // ESLint が「同じ名前のプラグインを再定義した」として落ちる（実測）。
  const layer = createFrameworkLayerPlugin();
  return [
    { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
    ...tseslint.configs.recommended.map((entry) => ({
      ...entry,
      files: FRAMEWORK_FILES,
    })),
    {
      files: FRAMEWORK_FILES,
      plugins: { layer },
      rules: {
        // 300 行は信号。超えるファイルは冒頭の JSDoc に `@oversize` と `@split-review` を持つ
        // （宣言の無い超過・行数を理由にした宣言・300 行以下に残った宣言は error）。
        "layer/declared-oversize": ["error", { max: 300 }],
        // 大きさの規則。数値は製品側（`app/eslint.config.mjs`）と**同じ 1 組**である ——
        // 現物の分布から決めたラチェットであり、置き場が変わると値が変わるものではない。
        "max-lines-per-function": [
          "error",
          { max: 180, skipBlankLines: false, skipComments: false, IIFEs: true },
        ],
        "max-depth": ["error", 4],
        "max-params": ["error", 7],
        // 禁止構文も製品と同じ 1 組を読む（正は `policies-syntax.mjs`）。テストにも掛ける ——
        // `vi.mock` 禁止はテストにしか現れない禁則である。
        "no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX],
        // 免除の一本化。`eslint-disable` 系コメントはコードに書けない（製品側と同じ）。
        "layer/no-eslint-disable-comment": "error",
        // **生の制御文字を埋めない。** `no-restricted-syntax` に相乗りさせない ——
        // 同じ名前を別ブロックで再定義すると配列が丸ごと置き換わる（docs 側で実際に
        // 2 本が消えていた。束 ①-c-d の独立レビュー）。名前が別なら誰にも消されない。
        "layer/no-raw-control-char": "error",
      },
    },
    {
      files: FRAMEWORK_FILES,
      ignores: FRAMEWORK_TEST_FILES,
      plugins: { jsdoc },
      settings: { jsdoc: { mode: "typescript" } },
      rules: {
        "jsdoc/require-jsdoc": [
          "error",
          {
            publicOnly: true,
            enableFixer: false,
            require: {
              FunctionDeclaration: true,
              ClassDeclaration: true,
              ClassExpression: true,
              ArrowFunctionExpression: true,
              FunctionExpression: true,
            },
            contexts: DOCUMENTED_CONTEXTS,
          },
        ],
        "jsdoc/require-description": [
          "error",
          {
            contexts: [
              "ArrowFunctionExpression",
              "ClassDeclaration",
              "ClassExpression",
              "FunctionDeclaration",
              "FunctionExpression",
              ...DOCUMENTED_CONTEXTS,
            ],
          },
        ],
        "jsdoc/require-param-description": "error",
        "jsdoc/require-returns-description": "error",
        "jsdoc/check-param-names": "error",
        "jsdoc/check-alignment": "error",
        "jsdoc/no-blank-blocks": "error",
        "jsdoc/empty-tags": "error",
      },
    },
    {
      // **外へ送る口の禁止**(`layer/no-external-network`。正は規則の注記)。出荷物の一部である `src` に掛ける。
      // 製品側と違ってアダプタの住所の免除は無い —— 仕組み側の `src` には外部連携のアダプタが無く、
      // 外へ送る口はそもそも持たない(いま `fetch` 等は 0 件)。足す日は、規則を緩めるのではなく
      // 設計(どこに置くか)を決め直す。
      files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      plugins: { layer },
      rules: { "layer/no-external-network": "error" },
    },
    {
      // **外へ送る `fetch` は `safeFetch` だけ**(`layer/require-safe-fetch`。ASVS V15.3.2)と、
      // **本文のある応答は `jsonResponse` / `textResponse` だけ**(`layer/require-charset-response`。ASVS V4.1.1)。
      // 範囲から外すのは、テストと、**部品自身の置き場の 2 本だけ**(グローバルの `fetch` を引く `safe-fetch.ts` と、
      // 本文つきの `new Response` を組む `response.ts`)。免除の口は他に無い。
      files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      ignores: [...FRAMEWORK_TEST_FILES, "src/http/safe-fetch.ts", "src/http/response.ts"],
      plugins: { layer },
      rules: { "layer/require-safe-fetch": "error", "layer/require-charset-response": "error" },
    },
    {
      // **転送を作れるのは安全な転送の部品だけ**(`layer/require-safe-redirect`。ASVS V3.7.2。点検 9 回目 B9-1〜B9-6)。
      // 仕組みの側も同じ規則の下に置き、範囲から外すのはテストと**部品自身の実装ファイル**(許可表 `SAFE_REDIRECT_PARTS`
      // の 1 か所)だけである。表の行は**パッケージとファイルの組**で当て、設定を当てるパッケージの行だけを外す
      // (`safeRedirectExemptions`。別のパッケージの同じ相対パスのファイルは規則の中に残る。点検 10 回目 B10-6)。
      files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      ignores: [...FRAMEWORK_TEST_FILES, ...safeRedirectExemptions(configUrl)],
      plugins: { layer },
      rules: { "layer/require-safe-redirect": "error" },
    },
    moduleStateBlock(layer, configUrl),
    {
      // **危ない API を出荷物(`src`)に書かせない**(ASVS V1.2.5・V1.2.9・V1.3.2・V3.5.5・V14.3.3・V13.4.2。
      // 6 本の正は各規則の注記)。製品側の設定と同じ 6 本 + `no-debugger` を `src` に掛け、
      // 範囲から外すのはテストだけ(敵対的な値を組む・出力を観測するため)。`console` の免除は次のブロックの 1 本だけ。
      files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      ignores: FRAMEWORK_TEST_FILES,
      plugins: { layer },
      rules: {
        "layer/no-os-command": "error",
        "layer/no-dynamic-regexp": "error",
        "layer/no-dynamic-code": "error",
        "layer/no-message-listener": "error",
        "layer/no-browser-storage": "error",
        "layer/no-console-output": "error",
        "no-debugger": "error",
        // `'use server'`(Server Action の口)は出荷物に置かない(7 回目 C7-1。許可の住所は無い — 口は製品の `_actions` の生成物だけ)。
        "layer/use-server-placement": "error",
      },
    },
    {
      // **枠から使うものを閉じた表に限る・DOM を手で組まない・nonce を読まない**(点検 12 回目 B12-1・B12-2)。CSP を組む `browser-defense.ts` だけが nonce を持つ
      // (もう 1 本の除外は、字句を表に持つ規則自身のファイル)。
      files: ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      ignores: FRAMEWORK_TEST_FILES,
      plugins: { layer },
      // 利用者の文字列の入口は `textInput()` だけ(`layer/no-raw-zod-string`。点検 20 回目 C20-2。文字列のスキーマを作ってよいのは入口の実装だけ)。
      rules: { "layer/closed-framework-surface": "error", "layer/no-dom-assembly": "error", "layer/no-raw-zod-string": "error" },
    },
    { files: ["src/domain/text-input.ts"], plugins: { layer }, rules: { "layer/no-raw-zod-string": "off" } },
    {
      files: ["src/http/browser-defense.ts", "src/rules/no-dom-assembly.mjs"],
      plugins: { layer },
      rules: { "layer/no-dom-assembly": "off" },
    },
    {
      // `console` の唯一の免除: セキュリティログの出力器(構造化した 1 行 JSON を出す口。ロガー自身の置き場)。
      files: ["src/operation/security-log.ts"],
      plugins: { layer },
      rules: { "layer/no-console-output": "off" },
    },
    {
      // 道具の木(`src` の外: スクリプト・テストの支援・設定・検証器の CLI)は `child_process` を引いてよいが、
      // **引数の配列で呼ぶ形だけ**(`exec` / `execSync`・`shell` オプション・動的 import / require は違反)。
      files: FRAMEWORK_FILES,
      ignores: ["src/**"],
      plugins: { layer },
      rules: { "layer/no-os-command": ["error", { allowImport: true }] },
    },
    // GIT_ を外す口(点検 23 回目 C23-1)は名前の分からない変数を全部消すのが仕事で設定の名前を読まない。この 2 本だけ K1 の読み方の形を外す(最後の線は開発用リポジトリの道具の木へ移した。点検 26 回目 O26-2)。
    { files: ["testing/git/without-git-env.mts", "testing/git/setup-without-git-env.mts"], rules: { "no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX.filter((entry) => !PROCESS_ENV_SELECTORS.includes(entry))] } },
    // ビルドの外への通信の見張りは、子のプロセスの口を包んで環境に前置きを足す(点検 20 回目 C20-4)。束縛の差し替えはこの 1 本だけ。
    { files: ["scripts/offline-guard.mjs"], plugins: { layer }, rules: { "layer/no-os-command": "off" } },
    {
      // `safe-fetch.ts` だけが、グローバルの `fetch` を引く(外へ送る口を 1 か所に集めるための唯一の場所)。
      files: ["src/http/safe-fetch.ts"],
      plugins: { layer },
      rules: { "layer/no-external-network": "off" },
    },
    {
      files: FRAMEWORK_TEST_FILES,
      // テスト本体は大きさの規則 4 つ（300 行の宣言を含む）を外す（製品側と**同じ線**。テストは網羅のために
      // 長く・深くなるのが正しい）。`no-restricted-syntax` は外さない —— `vi.mock` 禁止は
      // テストにしか現れない禁則であり、そこを外すと規則が意味を失う。
      rules: {
        "layer/declared-oversize": "off",
        "max-lines-per-function": "off",
        "max-depth": "off",
        "max-params": "off",
      },
    },
  ];
}
