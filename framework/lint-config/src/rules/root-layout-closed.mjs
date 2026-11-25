/**
 * **根の layout は読み取りを持てない**(点検 14 回目 B14-1)。
 *
 * Next.js は layout と page を同時に描き、同じ応答へ流す。page の関門が `redirect()` しても、layout の出力は 307 の本文に残る。根の layout は全部の画面の外側なので、
 * ここで値を読むと全部の未ログインの要求へ出る。根の layout は関門を持てない場所なので、推測はせず形を閉じる:
 *
 *   - 値の import は設定の表(`imports`。`{ module, names, why }`。`names` が null なら名前を問わない)に載るものだけ。型だけの import は通す
 *   - 動的 `import()`・`require()`・再 export は全部赤
 *   - `await` の相手は `next/server` の `connection()` だけ
 *
 * 非根の layout・`template` などのファイルは S7 が置かせない(`classifyPageFile`)ので、この規則が見るのは根の 1 本だけである。掛かる範囲は設定が決める。
 */

import { importOf } from "./require-safe-link.mjs";

/** `await` してよい唯一の呼び出しの出どころ。 */
const AWAITABLE = { module: "next/server", imported: "connection" };

/** @type {import("eslint").Rule.RuleModule} */
export const rootLayoutClosed = {
  meta: {
    type: "problem",
    docs: { description: "根の layout は読み取りを持てない(import は閉じた表・`await` は `connection()` だけ)" },
    schema: [{
      type: "object",
      properties: {
        imports: {
          type: "array",
          items: {
            type: "object",
            properties: { module: { type: "string" }, names: { type: ["array", "null"], items: { type: "string" } }, why: { type: "string", minLength: 1 } },
            required: ["module", "names", "why"],
            additionalProperties: false,
          },
        },
      },
      required: ["imports"],
      additionalProperties: false,
    }],
    messages: {
      module: "根の layout は `{{module}}` を引けません。layout の出力は関門の外側にあり、未ログインの 307 / 404 の本文にも載ります。足すなら表(`root-layout-rows.mjs`)に値を読まない理由を書く。",
      name: "根の layout は `{{module}}` の `{{name}}` を引けません(表の名前の外)。",
      opaque: "根の layout に動的な読み込みと再 export は置けません(表で閉じられない)。",
      await: "根の layout の `await` は `connection()` だけです。読み取りは画面の関門の中に置く。",
    },
  },
  create(context) {
    const rows = new Map((context.options[0]?.imports ?? []).map((row) => [row.module, row]));
    const sourceCode = context.sourceCode;

    /**
     * 値の import の名前を調べる。
     *
     * @param {import("estree").ImportDeclaration} node - import
     * @param {{ names: readonly string[] | null }} row - 表の行
     */
    function checkNames(node, row) {
      if (row.names === null) return;
      for (const specifier of node.specifiers) {
        if (specifier.importKind === "type") continue;
        const name = specifier.type === "ImportSpecifier" ? (specifier.imported.name ?? specifier.imported.value) : specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
        if (!row.names.includes(name)) context.report({ node: specifier, messageId: "name", data: { module: node.source.value, name } });
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const row = rows.get(node.source.value);
        if (row === undefined) context.report({ node, messageId: "module", data: { module: node.source.value } });
        else checkNames(node, row);
      },
      ImportExpression(node) {
        context.report({ node, messageId: "opaque" });
      },
      ExportAllDeclaration(node) {
        context.report({ node, messageId: "opaque" });
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined) context.report({ node, messageId: "opaque" });
      },
      TSImportEqualsDeclaration(node) {
        context.report({ node, messageId: "opaque" });
      },
      "CallExpression[callee.name='require']"(node) {
        context.report({ node, messageId: "opaque" });
      },
      AwaitExpression(node) {
        const argument = node.argument;
        const binding = argument.type === "CallExpression" && argument.callee.type === "Identifier" ? importOf(sourceCode.getScope(node), argument.callee.name) : null;
        if (binding?.module !== AWAITABLE.module || binding.imported !== AWAITABLE.imported) context.report({ node, messageId: "await" });
      },
      ForOfStatement(node) {
        if (node.await === true) context.report({ node, messageId: "await" });
      },
    };
  },
};
