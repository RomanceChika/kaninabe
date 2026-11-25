/**
 * 外へ送る `fetch` は **`safeFetch`(`@kaninabe/runtime/http/safe-fetch`)だけ**を使わせる(ASVS V15.3.2。意図しない転送について行かない)。
 *
 * グローバルの `fetch` は既定で `redirect: "follow"`。呼び先が 3xx を返すと、宣言していない別の行き先へ黙ってついて行く。
 * `safeFetch` は `redirect: "error"` に固定した `fetch` で、外へ送る口(外部連携のアダプタ・認証基盤のアダプタ・AI の SDK への
 * `fetch` の差し込み)は全部これを通す。**グローバルの `fetch` を参照すること自体**をここで止める。
 *
 * **束縛で見る**(名前では決めない。`require-safe-link` と同じ考え方): スコープ解析で、`fetch` が**宣言に解決できない
 * グローバルの参照**のときだけ違反にする。自前の関数・import・引数・変数の `fetch`(`import { fetch } from 'undici'` も
 * 別の話で、ここでは見ない。外へ送る入口の閉世界は `layer/no-external-network` と層境界が持つ)と、`server.fetch` のような
 * ふつうのプロパティは対象外。
 *
 * **塞いでいる形**(`no-external-network` と同じ読み方):
 *   - 直接の呼び出し・値としての参照(`const f = fetch` / `use(fetch)` / `{ fetch }` / `fetch ?? other`)
 *   - `globalThis` / `window` / `self` / `top` / `parent` / `frames` を経由した参照(TS のラッパ・`const` の別名・入れ子も)
 *   - それらからの分割代入(`const { fetch } = globalThis` / 引数の既定値 / 代入式 / `...rest`)
 * **型の位置**(`typeof fetch`)は対象外。**下限として残る形**: 計算した鍵・`Reflect` 経由・動的 `import()`(規約で書かない)。
 *
 * 範囲は設定側が決める(アダプタの住所・仕組み側の `src`。テストと、`safeFetch` 自身の置き場は外す)。同一オリジンへの
 * クライアント側の `fetch('/api/…')` は外へ送る口ではないので、この規則を掛ける範囲に入れない。
 */

import { findVariable, holderKind, memberName } from './no-external-network.mjs';

/**
 * 分割代入のパターンが、持ち主から `fetch` を取り出しているか(入れ子・`...rest` も見る)。
 *
 * @param {import("estree").Node} pattern - `{ fetch, window: { fetch: f } }` のようなパターン
 * @returns {boolean} 取り出していれば true
 */
function patternTakesFetch(pattern) {
  if (pattern.type !== "ObjectPattern") return false;
  return pattern.properties.some((property) => {
    if (property.type === "RestElement") return true;
    const computed = property.computed || property.key.type === "Literal";
    const name = memberName({ computed, property: property.key });
    if (name === null) return property.computed;
    if (name === "fetch") return true;
    const inner = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
    return ["globalThis", "window", "self", "top", "parent", "frames"].includes(name) && patternTakesFetch(inner);
  });
}

/** @type {import("eslint").Rule.RuleModule} */
export const requireSafeFetch = {
  meta: {
    type: "problem",
    docs: {
      description: "グローバルの fetch を直接使わせない。外へ送る口は safeFetch(@kaninabe/runtime/http/safe-fetch)を通す",
    },
    schema: [],
    messages: {
      global:
        "グローバルの `fetch` を直接使わない。外へ送る口は `safeFetch`(`@kaninabe/runtime/http/safe-fetch`)を通す(転送について行かない `redirect: \"error\"`。ASVS V15.3.2)。SDK へ `fetch` を差し込む口にも `safeFetch` を渡す。",
      holder:
        "`{{holder}}.fetch` でグローバルの `fetch` を使わない。外へ送る口は `safeFetch`(`@kaninabe/runtime/http/safe-fetch`)を通す(ASVS V15.3.2)。",
      destructure:
        "`globalThis` / `window` / `self` からの分割代入で `fetch` を取り出さない(取り出した名前は自前の宣言に見えて、この検査から外れる)。`safeFetch`(`@kaninabe/runtime/http/safe-fetch`)を使う。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const checkDestructure = (pattern, source, node) => {
      if (!source || pattern.type !== "ObjectPattern") return;
      if (holderKind(source, sourceCode.getScope(node)) !== "global") return;
      if (patternTakesFetch(pattern)) context.report({ node: pattern, messageId: "destructure" });
    };
    return {
      Program(program) {
        const scope = sourceCode.getScope(program);
        const global = scope.type === "global" ? scope : scope.upper;
        if (global === null) return;
        const references = [...global.through, ...(global.set.get("fetch")?.references ?? [])];
        const seen = new Set();
        for (const reference of references) {
          const node = reference.identifier;
          if (seen.has(node) || node.name !== "fetch") continue;
          seen.add(node);
          // 自前の宣言(同名の変数・関数・import・引数)を指す参照は対象外。
          if (reference.resolved !== null && reference.resolved.defs.length > 0) continue;
          if (findVariable(sourceCode.getScope(node), "fetch")?.defs.length) continue;
          // 型の位置(`typeof fetch`)は呼び出しではない。
          if (node.parent?.type === "TSTypeQuery") continue;
          context.report({ node, messageId: "global" });
        }
      },
      MemberExpression(node) {
        if (memberName(node) !== "fetch") return;
        if (holderKind(node.object, sourceCode.getScope(node)) !== "global") return;
        context.report({ node, messageId: "holder", data: { holder: sourceCode.getText(node.object) } });
      },
      VariableDeclarator: (node) => checkDestructure(node.id, node.init, node),
      AssignmentExpression: (node) => checkDestructure(node.left, node.right, node),
      AssignmentPattern: (node) => checkDestructure(node.left, node.right, node),
    };
  },
};
