/**
 * **DOM を手で組まない・文書の要素を画面に置かない・nonce を読まない**(点検 12 回目 B12-1・B12-3)。
 *
 * 文書の CSP は `script-src 'nonce-…' 'strict-dynamic'` で、`'strict-dynamic'` は nonce を持つスクリプトが足したスクリプトも信頼する。Next.js の起動スクリプトは
 * nonce を持つので、**スクリプトを足す口が 1 つでも残ると CSP を素通りする**(本番ビルド + Chromium で実測)。`next/script` は
 * `layer/closed-framework-surface` の閉じた表が止め、ここは残りの口を閉じる。どの形にも許す形を作らない(製品の木に `<script>` の使い手は 0 件)。
 *
 * 赤にするもの:
 *   - 文書の要素 {@link DOCUMENT_ELEMENTS}(JSX・`const Tag = 'script'` で選ぶ形・`createElement` の第 1 引数)
 *   - React の `createElement` の第 1 引数が辿れない形(props や計算した要素)
 *   - DOM の組み立て: `.createElement` / `.createElementNS`(相手を問わない)と分割代入での取り出し。画面は React の要素で描く
 *   - nonce の読み書き: `nonce` の属性・鍵・メンバー、`x-nonce` と `content-security-policy` の字句(大文字小文字を問わない)、`NONCE_REQUEST_HEADER` の import
 *   - 同じファイルの表から選ぶ文書の要素(`<Tags.s />`・`const S = Tags.s; <S />`。点検 13 回目 B13-7)
 *   - クライアントの木の送り先の書き込み: {@link URL_PROPERTIES} への代入・`Object.assign` の鍵・`Reflect.set` / `Reflect.defineProperty` / `Object.defineProperty` の鍵(字句でない鍵も赤)、
 *     `setAttribute` の閉じた表の外の名前と `setAttributeNS`
 *     (`a.href = next; a.click()`・`form.action = next`。クライアントの遷移に実行時の関所は無い)
 *
 * 最後の組は `{ serverLayer: true }` で外す(サーバーの層に DOM は無く、`.action` などの欄名は別の意味である)。免除の口は作らない。
 * 例外は CSP を組む実装のファイルだけで、設定が名指す。
 */

import { elementChoices, findVariable, importOf } from "./require-safe-link.mjs";
import { propertyName, stringValue } from "./redirect-sinks.mjs";

/** 画面に置けない文書の要素(スクリプト・埋め込み・文書の設定。どれも製品の木に使い手が無い)。 */
const DOCUMENT_ELEMENTS = new Set(["script", "iframe", "frame", "object", "embed", "base", "meta", "style"]);

/** DOM を組む口の名前。 */
const DOM_FACTORIES = new Set(["createElement", "createElementNS"]);

/** nonce を運ぶ見出しの字句(`content-security-policy` は Next.js が nonce を読む要求の見出し)。 */
const NONCE_HEADERS = new Set(["x-nonce", "content-security-policy", "content-security-policy-report-only"]);

/** 代入すると送り先や読み込み先になるプロパティ。 */
const URL_PROPERTIES = new Set(["href", "action", "formAction", "src", "srcset", "xlinkHref"]);

/** 第 2 引数の鍵に書き込む組み込み。 */
const REFLECTIVE_WRITERS = new Set(["Reflect.set", "Reflect.defineProperty", "Object.defineProperty"]);

/** `setAttribute` で置いてよい名前(`aria-*` / `data-*` も可)。 */
const SAFE_ATTRIBUTES = new Set(["inert", "hidden", "role", "tabindex"]);

/**
 * `setAttribute` の名前が閉じた表の中か。
 *
 * @param {string | null} name - 字句の名前(字句でなければ null)
 * @returns {boolean} 通すなら true
 */
function safeAttribute(name) {
  return name !== null && (SAFE_ATTRIBUTES.has(name) || /^(?:aria|data)-[a-z0-9-]+$/u.test(name));
}

/**
 * 同じファイルの `const` の表の、文字列の値を集める(`const Tags = { s: 'script' }`)。
 *
 * @param {string} name - 表の名前
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {readonly string[]} 値
 */
function tableElements(name, scope) {
  const init = findVariable(scope, name)?.defs[0]?.node?.init;
  let table = init;
  while (table !== null && table !== undefined && table.expression !== undefined && table.type !== "ObjectExpression") table = table.expression;
  if (table?.type !== "ObjectExpression") return [];
  return table.properties.flatMap((property) => {
    const value = property.type === "Property" ? stringValue(property.value) : null;
    return value === null ? [] : [value];
  });
}

/**
 * JSX の名前が同じファイルの表から選ぶ要素なら、その表の値を返す(`<Tags.s />`・`const S = Tags.s; <S />`)。
 *
 * @param {import("estree-jsx").JSXOpeningElement["name"]} name - 要素の名前
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {readonly string[]} 値
 */
function tableChoices(name, scope) {
  if (name.type === "JSXMemberExpression") {
    let root = name.object;
    while (root.type === "JSXMemberExpression") root = root.object;
    return root.type === "JSXIdentifier" ? tableElements(root.name, scope) : [];
  }
  if (name.type !== "JSXIdentifier") return [];
  let init = findVariable(scope, name.name)?.defs[0]?.node?.init;
  while (init !== null && init !== undefined && init.type !== "MemberExpression" && init.expression !== undefined) init = init.expression;
  if (init?.type !== "MemberExpression") return [];
  let root = init.object;
  while (root.type === "MemberExpression") root = root.object;
  return root.type === "Identifier" ? tableElements(root.name, scope) : [];
}

/**
 * オブジェクトのリテラルの鍵の名前(字句だけ)。
 *
 * @param {import("estree").Property} node - プロパティ
 * @returns {string | null} 名前
 */
function keyOf(node) {
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  return stringValue(node.key);
}

/** @type {import("eslint").Rule.RuleModule} */
export const noDomAssembly = {
  meta: {
    type: "problem",
    docs: { description: "DOM を手で組まない・スクリプトなどの文書の要素を画面に置かない・nonce を読まない(`strict-dynamic` の信頼の連鎖を閉じる)" },
    schema: [{ type: "object", properties: { serverLayer: { type: "boolean" } }, additionalProperties: false }],
    messages: {
      element: "`<{{name}}>` は画面に置けません。CSP の `strict-dynamic` は nonce を持つスクリプトの足したものを信頼するので、スクリプトの口は 1 つも開けない。文書の設定は枠の metadata で、外の埋め込みは設計の決定として別に扱う。",
      opaqueElement: "`createElement` の第 1 引数は字句か、辿れる部品だけです(要素の名前を確かめられない)。",
      domFactory: "`{{name}}` で DOM を組んではいけません。画面は React の要素で描く(スクリプトの注入と、遷移の検査の迂回の口になる)。",
      nonce: "nonce を読み書きしてはいけません(`{{name}}`)。nonce を持てば CSP を素通りする。nonce を使うのは Next.js の起動スクリプトだけ。",
      urlProperty: "`.{{name}}` に代入してはいけません。送り先は `<a>` / `Link` の属性(`layer/require-safe-link`)か `useSafeNavigate` で作る。",
      attribute: "`setAttribute` で置けるのは閉じた表の名前と `aria-*` / `data-*` だけです。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const clientTree = context.options[0]?.serverLayer !== true;

    /**
     * 字句が nonce を運ぶ見出しなら報告する。
     *
     * @param {import("estree").Node} node - 字句の節
     * @param {unknown} value - 値
     */
    function checkHeaderText(node, value) {
      if (typeof value === "string" && NONCE_HEADERS.has(value.toLowerCase())) context.report({ node, messageId: "nonce", data: { name: value } });
    }

    /**
     * `createElement` の第 1 引数を見る。
     *
     * @param {import("estree").CallExpression} node - 呼び出し
     */
    function checkReactElement(node) {
      const scope = sourceCode.getScope(node);
      const choice = elementChoices(node.arguments[0], scope);
      if (choice === null) return context.report({ node, messageId: "opaqueElement" });
      for (const name of choice) if (DOCUMENT_ELEMENTS.has(name)) context.report({ node, messageId: "element", data: { name } });
      return undefined;
    }

    /**
     * `.createElement` の相手が React の import か。
     *
     * @param {import("estree").MemberExpression} node - メンバー参照
     * @returns {boolean} React の口なら true
     */
    function reactMember(node) {
      return node.object.type === "Identifier" && importOf(sourceCode.getScope(node), node.object.name)?.module === "react";
    }

    return {
      JSXOpeningElement(node) {
        for (const element of tableChoices(node.name, sourceCode.getScope(node))) if (DOCUMENT_ELEMENTS.has(element)) context.report({ node, messageId: "element", data: { name: element } });
        if (node.name.type !== "JSXIdentifier") return;
        const name = node.name.name;
        // 大文字の名前は辿れる範囲だけを見る(props で受けた部品などは要素の名前が読めない。`<script>` の書き手がその形を選ぶ理由は無い)。
        const choice = /^[a-z]/u.test(name) ? [name] : (elementChoices({ type: "Identifier", name }, sourceCode.getScope(node)) ?? []);
        for (const element of choice) if (DOCUMENT_ELEMENTS.has(element)) context.report({ node, messageId: "element", data: { name: element } });
      },
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name.toLowerCase() === "nonce") context.report({ node, messageId: "nonce", data: { name: "nonce" } });
      },
      CallExpression(node) {
        const callee = node.callee;
        const binding = callee.type === "Identifier" ? importOf(sourceCode.getScope(node), callee.name) : null;
        if (binding?.module === "react" && binding.imported === "createElement") checkReactElement(node);
        if (callee.type === "MemberExpression" && propertyName(callee) === "createElement" && reactMember(callee)) checkReactElement(node);
        if (!clientTree || callee.type !== "MemberExpression") return;
        const name = propertyName(callee);
        const reflected = callee.object.type === "Identifier" ? `${callee.object.name}.${name}` : "";
        if (REFLECTIVE_WRITERS.has(reflected)) {
          const key = stringValue(node.arguments[1]);
          // 字句でない鍵を赤にするのは値を書く口だけ(`Object.defineProperty(f, MARK, …)` の印は送り先にならない)。
          if ((key === null && reflected !== "Object.defineProperty") || (key !== null && URL_PROPERTIES.has(key))) context.report({ node, messageId: "urlProperty", data: { name: key ?? "計算した鍵" } });
        }
        if (name === "setAttributeNS" || (name === "setAttribute" && !safeAttribute(stringValue(node.arguments[0])))) context.report({ node, messageId: "attribute" });
        if (name === "assign" && callee.object.type === "Identifier" && callee.object.name === "Object" && node.arguments[0]?.type !== "ObjectExpression") {
          for (const source of node.arguments.slice(1)) {
            if (source.type !== "ObjectExpression") continue;
            for (const property of source.properties) {
              if (property.type === "Property" && URL_PROPERTIES.has(keyOf(property) ?? "")) context.report({ node: property, messageId: "urlProperty", data: { name: keyOf(property) } });
            }
          }
        }
      },
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === "nonce") context.report({ node, messageId: "nonce", data: { name } });
        if (name !== null && DOM_FACTORIES.has(name) && !reactMember(node)) context.report({ node, messageId: "domFactory", data: { name } });
      },
      Property(node) {
        const name = keyOf(node);
        if (name === "nonce") context.report({ node, messageId: "nonce", data: { name } });
        if (name !== null && DOM_FACTORIES.has(name) && node.parent.type === "ObjectPattern") context.report({ node, messageId: "domFactory", data: { name } });
      },
      Literal: (node) => checkHeaderText(node, node.value),
      TemplateElement: (node) => checkHeaderText(node, node.value.cooked),
      ImportSpecifier(node) {
        const name = node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
        if (name === "NONCE_REQUEST_HEADER") context.report({ node, messageId: "nonce", data: { name } });
      },
      AssignmentExpression(node) {
        if (!clientTree || node.left.type !== "MemberExpression") return;
        const name = propertyName(node.left);
        if (name !== null && URL_PROPERTIES.has(name)) context.report({ node, messageId: "urlProperty", data: { name } });
      },
    };
  },
};
