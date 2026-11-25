/**
 * `window` / `self` で `message` を受ける口を、製品の実行コードに**持たせない**(ASVS V3.5.5。postMessage は出どころと形を確かめてから受ける)。
 *
 * **選んだ形: 受け手そのものを禁止する**(「出どころと形を確かめる部品だけに許す」より厳しい側)。このアプリは
 * `postMessage` を受ける口を持たず、持つ理由もない。確かめる部品(`onTrustedMessage(origins, schema, handler)`)を先に作ると、
 * 部品の中の確かめが正しいことまで検査の責任になる。受ける必要が出た日は、規則を緩めるのではなく、部品を設計して
 * その置き場だけを設定で外す(免除の口は設定側の住所の宣言であり、コードに `eslint-disable` は書けない)。
 *
 * 止めるもの(持ち主は `globalThis` / `window` / `self` / `top` / `parent` / `frames` と、グローバルの `addEventListener` そのもの):
 *   - `addEventListener('message' | 'messageerror', …)`(第 1 引数が静的に決まらない形も、`message` かもしれないので違反)
 *   - `onmessage = …` / `onmessageerror = …`(代入も読み取りも。`window.onmessage` も)
 *   - それらの分割代入での取り出し(`const { addEventListener } = window`)・値としての持ち出し(`const add = window.addEventListener`)
 * 束縛で見る(自前の `addEventListener` / `onmessage` は対象外)。他のイベント(`resize` など静的に決まる名前)は通す。
 * **下限として残る形**: 別スレッドの受け手(`x.onmessage`)・`BroadcastChannel` / `MessagePort` / `navigator.serviceWorker` など、
 * 持ち主がグローバルでない受け手(出どころがオリジンでない口。このアプリは持たない)。
 */

import { findVariable } from "./no-external-network.mjs";
import { globalNameVisitors } from "./danger-helpers.mjs";

/** 対象の名前。 */
const NAMES = new Set(["addEventListener", "onmessage", "onmessageerror"]);

/** 受けてはいけないイベント名。 */
const MESSAGE_EVENTS = new Set(["message", "messageerror"]);

/**
 * イベント名の引数を静的な文字列に読む(リテラル・式の無いテンプレート・`const` の束ね)。
 *
 * @param {import("estree").Node | undefined} node - 第 1 引数
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @returns {string | undefined} 読めた文字列(読めなければ undefined)
 */
function eventName(node, scope, depth = 0) {
  if (node === undefined || depth > 3) return undefined;
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  if (node.type !== "Identifier") return undefined;
  const variable = findVariable(scope, node.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const" || !definition.node.init) return undefined;
  return eventName(definition.node.init, variable.scope, depth + 1);
}

/** @type {import("eslint").Rule.RuleModule} */
export const noMessageListener = {
  meta: {
    type: "problem",
    docs: { description: "window / self で message を受ける口(addEventListener('message') / onmessage)を持たせない。ASVS V3.5.5" },
    schema: [],
    messages: {
      listener:
        "`message` を受ける口を持たない(`postMessage` の送り手のオリジンと形を確かめる部品がまだ無い。ASVS V3.5.5)。受ける必要が出たら、出どころ(origin)と形(スキーマ)を確かめる部品を設計してから、その置き場だけを設定で外す。",
      dynamic: "`addEventListener` のイベント名が静的に決まらない(`message` かもしれない)。`'resize'` のようにリテラルで書く。ASVS V3.5.5。",
      handler: "`{{name}}` に代入・参照しない(`message` を受ける口。ASVS V3.5.5)。",
      alias: "`addEventListener` / `onmessage` を呼び出し以外の形(別名・分割代入)で持ち出さない(イベント名の検査から外れる)。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return globalNameVisitors(context, NAMES, (node, name, via) => {
      if (via === "destructure") return context.report({ node, messageId: "alias" });
      const resolved = via === "reference" ? name : (node.property.name ?? node.property.value);
      if (resolved !== "addEventListener") return context.report({ node, messageId: "handler", data: { name: resolved } });
      const parent = node.parent;
      if (parent.type !== "CallExpression" || parent.callee !== node) return context.report({ node, messageId: "alias" });
      const type = eventName(parent.arguments[0], sourceCode.getScope(parent));
      if (type === undefined) return context.report({ node: parent, messageId: "dynamic" });
      if (MESSAGE_EVENTS.has(type)) return context.report({ node: parent, messageId: "listener" });
      return undefined;
    });
  },
};
