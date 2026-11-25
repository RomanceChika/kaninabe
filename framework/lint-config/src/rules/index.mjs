/**
 * ローカル ESLint プラグイン `layer`。
 *
 * このリポジトリの層構成（ARCH-BE-0001）と配置・命名規約（server-actions.md）のうち、
 * 既存プラグインで表現できないものだけをルール化して置く。
 * 執行対象の一覧の正はドキュメント側であり、ここはその実装である。
 *
 * **プラグインは関数で組む。** 規則 1 本（`operation-naming`）が製品の構造の宣言
 * （生成物 `framework-structure.json`）を要るので、それを**製品から受け取る** ——
 * 仕組み側のパッケージが製品の生成物を読む向きを作らないための裏返しである
 * （設計メモ `docs/design/runtime-package.md` §3-2）。残りの規則は宣言を要らない。
 */

import { actionNaming } from "./action-naming.mjs";
import { closedFrameworkSurface } from "./closed-framework-surface.mjs";
import { declaredOversize } from "./declared-oversize.mjs";
import { generatedHeader } from "./generated-header.mjs";
import { noCorsHeader } from "./no-cors-header.mjs";
import { noDirectActionCall } from "./no-direct-action-call.mjs";
import { noDomAssembly } from "./no-dom-assembly.mjs";
import { noBrowserStorage } from "./no-browser-storage.mjs";
import { noBareDbError } from "./no-bare-db-error.mjs";
import { noFailurePrefixAssert } from "./no-failure-prefix-assert.mjs";
import { noRawZodString } from "./no-raw-zod-string.mjs";
import { noConsoleOutput } from "./no-console-output.mjs";
import { noDynamicCode } from "./no-dynamic-code.mjs";
import { noDynamicRegexp } from "./no-dynamic-regexp.mjs";
import { noMessageListener } from "./no-message-listener.mjs";
import { noModuleState } from "./no-module-state.mjs";
import { nodeBuiltinClosed } from "./node-builtin-closed.mjs";
import { rootLayoutClosed } from "./root-layout-closed.mjs";
import { noOsCommand } from "./no-os-command.mjs";
import { noOpaqueModuleSpecifier } from "./no-opaque-module-specifier.mjs";
import { noEslintDisableComment } from "./no-eslint-disable-comment.mjs";
import { noExternalNetwork } from "./no-external-network.mjs";
import { noRawControlChar } from "./no-raw-control-char.mjs";
import { noRawHtml } from "./no-raw-html.mjs";
import { outboundPrimitiveHome } from "./outbound-primitive-home.mjs";
import { queryNaming } from "./query-naming.mjs";
import { queryParamWindow } from "./query-param-window.mjs";
import { requireCharsetResponse } from "./require-charset-response.mjs";
import { requireSafeFetch } from "./require-safe-fetch.mjs";
import { requireSafeLink } from "./require-safe-link.mjs";
import { requireSafeRedirect } from "./require-safe-redirect.mjs";

/** 転送の規則の唯一の例外(安全な転送の部品の実装ファイル)。設定とテストが同じ表を読む。 */
export { SAFE_REDIRECT_PARTS } from "./require-safe-redirect.mjs";
/** 枠の閉じた表(規則のテストが、行が今も使われていることを見る)。 */
export { FRAMEWORK_DIRECTIVES, FRAMEWORK_ENTRIES, SEGMENT_EXPORTS } from "./framework-entries.mjs";
/** モジュールの最上位の値の閉じた表(規則のテストが、行が今も使われていることを見る)。 */
export { FRAMEWORK_MODULE_STATE_ROWS } from "./module-state-table.mjs";
/** zod の文字列のスキーマを作る関数の閉じた表(規則のテストが zod の型定義から作り直して突き合わせる。点検 20 回目 C20-2)。 */
/** 入力の境界の開いた object の閉じた表と、それを許す所の理由つきの表(点検 25 回目 O25-2。規則のテストが行の実在を見る)。 */
export { EXTRA_STRING_BUILDERS, OPEN_OBJECT_ACCEPTED, OPEN_OBJECT_BUILDERS, ZOD_STRING_BUILDERS } from "./no-raw-zod-string.mjs";
import { requireServerOnly } from "./require-server-only.mjs";
import { sessionTokensServerOnly } from "./session-tokens-server-only.mjs";
import { createOperationNaming } from "./operation-naming.mjs";
import { useServerPlacement } from "./use-server-placement.mjs";

/**
 * ESLint flat config の `plugins` に渡すローカルプラグインを組む。
 *
 * @param frameworkStructure - 製品の生成物 `framework-structure.json` の中身
 * @returns `layer` プラグイン
 */
export function createLayerPlugin(frameworkStructure) {
  return {
    meta: { name: "layer", version: "1.0.0" },
    rules: {
      "require-server-only": requireServerOnly,
      "require-safe-link": requireSafeLink,
      "require-safe-redirect": requireSafeRedirect,
      "require-safe-fetch": requireSafeFetch,
      "require-charset-response": requireCharsetResponse,
      "no-raw-html": noRawHtml,
      "closed-framework-surface": closedFrameworkSurface,
      "no-dom-assembly": noDomAssembly,
      "action-naming": actionNaming,
      "operation-naming": createOperationNaming(frameworkStructure),
      "query-naming": queryNaming,
      "query-param-window": queryParamWindow,
      "generated-header": generatedHeader,
      "no-direct-action-call": noDirectActionCall,
      "no-eslint-disable-comment": noEslintDisableComment,
      "no-external-network": noExternalNetwork,
      "outbound-primitive-home": outboundPrimitiveHome,
      "no-cors-header": noCorsHeader,
      "no-browser-storage": noBrowserStorage,
      "no-console-output": noConsoleOutput,
      "no-bare-db-error": noBareDbError,
      "no-failure-prefix-assert": noFailurePrefixAssert,
      "no-raw-zod-string": noRawZodString,
      "no-dynamic-code": noDynamicCode,
      "no-dynamic-regexp": noDynamicRegexp,
      "no-message-listener": noMessageListener,
      "no-module-state": noModuleState,
      "node-builtin-closed": nodeBuiltinClosed,
      "root-layout-closed": rootLayoutClosed,
      "no-os-command": noOsCommand,
      "no-opaque-module-specifier": noOpaqueModuleSpecifier,
      "no-raw-control-char": noRawControlChar,
      "declared-oversize": declaredOversize,
      "session-tokens-server-only": sessionTokensServerOnly,
      "use-server-placement": useServerPlacement,
    },
  };
}

/**
 * 構造の宣言を要らない規則だけのプラグイン（仕組み側のパッケージ自身を lint するとき）。
 *
 * `framework/**` には集約が無いので `operation-naming` は出番が無い。**空の宣言を渡して形だけ
 * 通すことはしない** —— 使わない規則を持たないほうが、何が効いているかが読める。
 *
 * 入っているのは 17 本(9 つ + 危ない API の 6 規則: `no-os-command` / `no-dynamic-regexp` / `no-dynamic-code` / `no-message-listener` / `no-browser-storage` / `no-console-output` + 枠の閉じた表の 2 本 `closed-framework-surface` / `no-dom-assembly`。点検 12 回目)。
 * 8 つ目の `use-server-placement` は、出荷物の `src` に `'use server'`(Server Action の口)を置かせない(7 回目 C7-1。許可の住所は無い)。
 * 9 つ目の `require-safe-redirect` は、転送を安全な部品だけで作らせる(9 回目 B9-1〜B9-6。例外は部品自身の実装ファイルの許可表)。
 * ほかは `no-eslint-disable-comment`（免除の一本化）と
 * `no-raw-control-char`（生の制御文字の禁止。母集合は 3 つの木すべて）と
 * `declared-oversize`（300 行を超えるファイルの宣言。3 つの木すべて）と
 * `no-external-network`（外へ送る口の禁止。`@kaninabe/runtime` の `src` に掛ける。出荷物の一部に
 * 外への送信口が混ざらないため）と
 * `require-server-only`（S1）である。S1 は**サーバー専用層がパッケージへ移った**ので要る
 * （ADR-0013）—— 製品側の設定は `app/src/**` しか見ないので、移した接続層・受信の段取りから
 * 宣言が消えても誰も咎めない状態になっていた。
 *
 * @returns `layer` プラグイン
 */
export function createFrameworkLayerPlugin() {
  return {
    meta: { name: "layer", version: "1.0.0" },
    rules: {
      "no-eslint-disable-comment": noEslintDisableComment,
      "no-external-network": noExternalNetwork,
      "outbound-primitive-home": outboundPrimitiveHome,
      "no-browser-storage": noBrowserStorage,
      "no-console-output": noConsoleOutput,
      "no-dynamic-code": noDynamicCode,
      "no-dynamic-regexp": noDynamicRegexp,
      "no-message-listener": noMessageListener,
      "no-module-state": noModuleState,
      "no-os-command": noOsCommand,
      "require-safe-fetch": requireSafeFetch,
      "require-charset-response": requireCharsetResponse,
      "require-safe-redirect": requireSafeRedirect,
      "no-raw-control-char": noRawControlChar,
      "declared-oversize": declaredOversize,
      "require-server-only": requireServerOnly,
      "use-server-placement": useServerPlacement,
      "closed-framework-surface": closedFrameworkSurface,
      "no-dom-assembly": noDomAssembly,
      "no-raw-zod-string": noRawZodString,
    },
  };
}
