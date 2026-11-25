/**
 * **外へ送る口は置き場の下でだけ値として引ける**(点検 10 回目 B10-3)。
 *
 * 9 回目 B9-4 の直しは外部の SDK のパッケージを外部連携ごとの置き場(`adapter_root`・土台)に閉じた。ところが外へ送る口そのもの
 * (`safeFetch`・Node の `node:http` / `node:https` / `node:net` / `node:tls` などの通信の組み込み・`undici`)は基盤の層のどこからでも
 * 引けたので、SDK を REST に替えるだけで集約名のディレクトリから有料の API を直に呼べた。この規則は SDK と同じ閉世界を口にも掛ける。
 *
 * 表は製品の生成物 `sdk-homes.json` の `outbound`(口の閉じた表の正は spec-tools の `outbound-primitives.ts`、置き場の正は
 * external_spec の `adapter_root` と土台)で、製品の設定が `options` に渡す(規則は製品の生成物を読まない)。同じ表を検証器の
 * X1 の (d) も読む。グローバルの `fetch` / `WebSocket` などは `layer/no-external-network` が同じ置き場の外で止める。
 *
 * 見る形: 値の `import`(副作用だけの import を含む)・`export … from`・`export * from`・字句の動的 `import()`・字句の `require()`。
 * 型だけの import / export は実行時に何も呼ばないので見ない。字句でない指定子は `layer/no-opaque-module-specifier` が止める。
 */

import path from "node:path";

/**
 * 指定子を口の表の綴りに畳む(`https` → `node:https`・`node:dns/promises` → `node:dns`・`undici/types` → `undici`・`.js` を落とす)。
 *
 * @param {string} specifier - import の指定子
 * @param {readonly string[]} primitives - 口の閉じた表
 * @returns {string | null} 表の綴り(口でなければ null)
 */
export function primitiveOf(specifier, primitives) {
  const spelled = specifier.replace(/\.js$/u, "");
  if (primitives.includes(spelled)) return spelled;
  const bare = spelled.startsWith("node:") ? spelled.slice("node:".length) : spelled;
  const head = bare.split("/")[0] ?? "";
  if (primitives.includes(`node:${head}`)) return `node:${head}`;
  if (!head.startsWith("@") && primitives.includes(head)) return head;
  return null;
}

/**
 * ファイルが置き場の下か(区切りは `/`。置き場は設定の根からの相対)。
 *
 * @param {string} file - 設定の根からの相対パス
 * @param {readonly string[]} homes - 置き場
 * @returns {boolean} 下なら true
 */
export function underHome(file, homes) {
  return homes.some((home) => file === home || file.startsWith(`${home}/`));
}

/** @type {import("eslint").Rule.RuleModule} */
export const outboundPrimitiveHome = {
  meta: {
    type: "problem",
    docs: { description: "外へ送る口(safeFetch・Node の通信の組み込み・undici)は外部連携の adapter_root と土台の下でだけ値として引ける" },
    schema: [
      {
        type: "object",
        properties: { primitives: { type: "array", items: { type: "string" } }, homes: { type: "array", items: { type: "string" } } },
        required: ["primitives", "homes"],
        additionalProperties: false,
      },
    ],
    messages: {
      outside:
        "{{specifier}} は外へ送る口です。値として引けるのは外部連携の adapter_root と土台の下だけです({{homes}})。送信をその相手の adapter_root の下のアダプタに置き、external.md の integrations に宣言する(有料の連携なら runPaidEntry から呼ぶ)。",
    },
  },
  create(context) {
    const { primitives, homes } = context.options[0];
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    if (underHome(file, homes)) return {};
    const label = homes.length === 0 ? "置き場の宣言なし" : homes.join(" / ");

    /**
     * 指定子が口なら報告する。
     *
     * @param {import("estree").Node} node - 位置
     * @param {unknown} value - 指定子の値
     */
    function check(node, value) {
      if (typeof value !== "string" || primitiveOf(value, primitives) === null) return;
      context.report({ node, messageId: "outside", data: { specifier: value, homes: label } });
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        if (node.specifiers.length > 0 && node.specifiers.every((specifier) => specifier.importKind === "type")) return;
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined && node.exportKind !== "type") check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type") check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments[0]?.type === "Literal") check(node, node.arguments[0].value);
      },
    };
  },
};
