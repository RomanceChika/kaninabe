/**
 * ブラウザの保存領域(`localStorage` / `sessionStorage` / `indexedDB` / `openDatabase` / `cookieStore` / `document.cookie`)に
 * 触れさせない(ASVS V14.3.3。ブラウザの保存領域にセッションのトークン以外の機微なデータを置かない)。
 *
 * **選んだ形: 触れること自体を禁止する**(「機微かどうか」は字面で決まらない)。ログインのトークンはサーバーだけが持つ
 * `HttpOnly` の cookie(`session-tokens-server-only` の案 A)で、画面の状態はサーバーの応答とフォームが持つ。読み取りも禁止する
 * (`document.cookie` を読む理由は、スクリプトから読める cookie を作る前提でしか生まれない)。
 * **免除の住所は設けない**(現時点で製品に正当な利用が 0 件)。非機微な利用(例: 画面の折りたたみの記憶)が要る日は、
 * `escapeRegExp` と同じく**狭い部品**を `@kaninabe/runtime` に設計し、その置き場だけを設定で外す(理由つき)。コードに `eslint-disable` は書けない。
 *
 * 束縛で見る: グローバルの名前が宣言に解決できないときだけ(自前の変数・引数・import の同名は対象外)。
 * `window.localStorage` / `globalThis['sessionStorage']` / `const s = localStorage` / 分割代入の取り出し(`const { localStorage } = window`)・
 * `window.document.cookie` / `const d = document; d.cookie` / `const { cookie } = document` も止める。型の位置は対象外。
 * **下限として残る形**: 計算した鍵・`Reflect.get(window, 'localStorage')`・`Storage.prototype` の差し替え・`caches`(Cache API)。
 */

import { memberName } from "./no-external-network.mjs";
import { globalNameVisitors, patternTakes, resolvesToGlobal } from "./danger-helpers.mjs";

/** 禁止するグローバルの保存領域。 */
const STORES = new Set(["localStorage", "sessionStorage", "indexedDB", "openDatabase", "cookieStore"]);

/** `document` だけを取り出したい集合。 */
const DOCUMENT = new Set(["document"]);

/** `cookie` だけを取り出したい集合。 */
const COOKIE = new Set(["cookie"]);

/** @type {import("eslint").Rule.RuleModule} */
export const noBrowserStorage = {
  meta: {
    type: "problem",
    docs: { description: "localStorage / sessionStorage / indexedDB / document.cookie などブラウザの保存領域に触れさせない。ASVS V14.3.3" },
    schema: [],
    messages: {
      store:
        "ブラウザの保存領域(`{{name}}`)に触れない(セッションのトークン以外の機微なデータを置かない。ASVS V14.3.3)。状態はサーバーの応答とフォームが持つ。非機微な利用が要るなら、狭い部品を @kaninabe/runtime に設計して置き場を設定で外す。",
      cookie: "`document.cookie` に触れない(スクリプトが読み書きする cookie は `HttpOnly` も `Secure` も付かない。ASVS V14.3.3)。cookie を書くのはサーバーの口だけ。",
      destructure: "`globalThis` / `window` / `self` / `document` からブラウザの保存領域を分割代入で取り出さない(取り出した名前は検査から外れる)。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const checkDocument = (pattern, source, node) => {
      if (!source || pattern.type !== "ObjectPattern") return;
      if (resolvesToGlobal(source, sourceCode.getScope(node), DOCUMENT) === null) return;
      if (patternTakes(pattern, COOKIE)) context.report({ node: pattern, messageId: "cookie" });
    };
    return {
      ...globalNameVisitors(context, STORES, (node, name, via) => {
        if (via === "destructure") return context.report({ node, messageId: "destructure" });
        const resolved = via === "reference" ? name : (node.property.name ?? node.property.value);
        return context.report({ node, messageId: "store", data: { name: resolved } });
      }),
      "MemberExpression:exit"(node) {
        if (memberName(node) !== "cookie") return;
        if (resolvesToGlobal(node.object, sourceCode.getScope(node), DOCUMENT) !== null) context.report({ node, messageId: "cookie" });
      },
      "VariableDeclarator:exit": (node) => checkDocument(node.id, node.init, node),
      "AssignmentExpression:exit": (node) => checkDocument(node.left, node.right, node),
      "AssignmentPattern:exit": (node) => checkDocument(node.left, node.right, node),
    };
  },
};
