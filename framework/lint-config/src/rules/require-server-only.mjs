/**
 * `import "server-only"` の宣言を必須化するローカルルール（ARCH-BE-0001 の E7）。
 *
 * 層境界（components から infrastructure/composition を import 禁止）は静的な import
 * グラフしか見ないため、動的 import や将来の抜け道を塞ぐ第二防衛線として
 * ランタイム/ビルド時のガードを併用する。
 */

/** @type {import("eslint").Rule.RuleModule} */
export const requireServerOnly = {
  meta: {
    type: "problem",
    docs: {
      description:
        "サーバー専用層のモジュールに import 'server-only' を必須化する",
    },
    schema: [],
    messages: {
      missing:
        'サーバー専用層のモジュールは先頭で import "server-only"; を宣言すること（クライアントバンドルへの混入をビルド時に検出するため）。',
    },
  },
  create(context) {
    return {
      Program(node) {
        const declared = node.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" &&
            statement.source.value === "server-only",
        );
        if (!declared) {
          context.report({ loc: { line: 1, column: 0 }, messageId: "missing" });
        }
      },
    };
  },
};
