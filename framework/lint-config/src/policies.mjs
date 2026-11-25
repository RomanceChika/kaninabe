/**
 * 設定値としてのポリシー表（ルール実装ではなく、ルールに渡すデータ）の**入口**。
 *
 * 中身は規則の種類ごとに割れている（層境界 `policies-boundaries.mjs` / `docs/` を指す import の
 * 禁止 `policies-docs-imports.mjs` / 禁止構文 `policies-syntax.mjs`(環境変数の読み方と matcher の無い `expect` の 2 組は
 * `policies-syntax-selectors.mjs`)/ 画面の見え方と文言にかかる禁止構文 `policies-ux.mjs`）。利用側（製品の `eslint.config.mjs` と、ポリシーの実効性を確かめる差分テスト）は今までどおり
 * ここ 1 つから import する。
 *
 * 「どの層が何を import してよいか」の正は ARCH-BE-0001 の「依存方向」の表であり、
 * ここはその機械執行の記述である。
 */

export {
  RESTRICTED_SYNTAX,
  QUERY_RESTRICTED_SYNTAX,
  INPUT_RESTRICTED_SYNTAX,
  TESTID_RESTRICTED_SYNTAX,
  STYLE_RESTRICTED_SYNTAX,
  PROCESS_ENV_SELECTORS,
  DISABLED_TEST_SELECTORS,
  EXPECT_MATCHER_SELECTORS,
} from "./policies-syntax.mjs";
export {
  PREVIEW_ONLY_RESTRICTED_SYNTAX,
  ACTION_POLICY_RESTRICTED_SYNTAX,
  LINK_RESTRICTED_SYNTAX,
  ERROR_KIND_RESTRICTED_SYNTAX,
} from "./policies-ux.mjs";
export { BOUNDARY_POLICIES } from "./policies-boundaries.mjs";
export { INFRASTRUCTURE_EXTERNAL_PACKAGES, UI_FOUNDATION_PACKAGES } from "./policies-external-packages.mjs";
export { sdkHomeBoundaries } from "./policies-sdk-homes.mjs";
export { DOCS_IMPORT_PATTERNS } from "./policies-docs-imports.mjs";
export { ANY_PREFIX, RUNTIME_ELEMENTS, lintConfigBoundaryElement, runtimeBoundaryElements } from "./runtime-elements.mjs";
