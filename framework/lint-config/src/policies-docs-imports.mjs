/**
 * `docs/` と検証器・生成器の木（`legacy/spec-tools/`）を指す import の禁止パターンの置き場。
 *
 * 層境界（`policies-boundaries.mjs`）とは別に、道具の木を指す import の禁止だけを持つ。
 * 入口は `policies.mjs` 1 つである。
 */

/**
 * 道具の木（`docs/` と `legacy/spec-tools/`）を指す import の禁止パターン
 * （`no-restricted-imports` の `patterns` に渡す）。
 *
 * **借りる向きは一方通行である。** 道具の木（検証器・生成器）が製品の実物を借りる例外は
 * もう **0 本**（束 分離 ②-b2 で、差分テストの 2 本が検証器・生成器の木へ移った。
 * docs/rules/process/common/tooling/standards/scripts-code-quality.md §借りる向き）。
 * 逆が 1 本でも通るとアプリのビルドが道具のツールチェーン（z3・vitepress）に依存し、
 * 仕様の正が実装の都合で動かせなくなる。アプリが読んでよいのは仕様の**生成物**
 * （`app/src/domain/generated/**`）だけである。
 *
 * パターンを分けるのは、相対で遡る形（`../../../docs/...`）と、パッケージ名のように見える形
 * （`docs/...`・`@kaninabe/spec-tools`）の両方を、木ごとに落とすためである。
 */
export const DOCS_IMPORT_PATTERNS = [
  {
    group: ["**/docs/**", "docs/**", "**/docs", "docs"],
    message:
      "app は docs/ を import しない（借りる向きは docs → app の一方通行。enforcement-matrix の B14）。" +
      "仕様から要るものは生成物（@/domain/generated/**）として受け取ること。",
  },
  {
    group: [
      "**/legacy/spec-tools/**",
      "legacy/spec-tools/**",
      "**/legacy/spec-tools",
      "legacy/spec-tools",
      "@kaninabe/spec-tools",
      "@kaninabe/spec-tools/**",
    ],
    message:
      "製品は検証器・生成器（legacy/spec-tools）を import しない（借りる向きは道具 → 製品の一方通行。" +
      "enforcement-matrix の B14）。仕様から要るものは生成物（@/domain/generated/**）として受け取ること。",
  },
];
