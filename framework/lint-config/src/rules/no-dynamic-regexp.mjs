/**
 * 利用者の値から正規表現を組ませない(ASVS V1.2.9。正規表現に入れる値の特殊文字をエスケープする)。
 *
 * `new RegExp(x)` / `RegExp(x)` の**パターンが静的に決まる形だけ**を通す:
 *   - 文字列リテラル・正規表現リテラル・式の無いテンプレート
 *   - 静的な文字列の連結(`'^' + HOST`)・両枝が静的な条件式・初期値が静的な文字列の `const` の識別子
 *   - 置換 `${…}` / `+` の項が **`escapeRegExp(…)` の呼び出し**(`@kaninabe/runtime/regexp`。import の束縛で見る)
 * それ以外(`new RegExp(userInput)` / `new RegExp(`^${name}$`)` など)は違反。`String#match(x)` / `split(x)` のように
 * 文字列を渡すと内部で正規表現になる口は、受け手の型が要るのでこの規則は見ない(下限として残る形)。
 *
 * **束縛で見る**: `RegExp` が宣言に解決できないグローバルのときだけ。`globalThis.RegExp` / `window.RegExp` / `const R = globalThis.RegExp` /
 * 分割代入の取り出しも同じ扱い。値としての持ち出し(`const R = RegExp; new R(x)`)は検査から外れるので、呼び出し・
 * `instanceof`・静的メンバ(`RegExp.prototype`)以外の参照は違反にする。自前の宣言の `RegExp`・型の位置は対象外。
 * 範囲は設定側(テストを除く製品の実行コード)。
 */

import { findVariable } from "./no-external-network.mjs";
import { globalNameVisitors, isStaticString } from "./danger-helpers.mjs";

/** 間接の呼び出しにならない、読むだけの性質。 */
const SAFE_MEMBERS = new Set(["prototype", "name", "length", "escape"]);

/** 対象のグローバル。 */
const NAMES = new Set(["RegExp"]);

/** エスケープ部品の置き場(`@kaninabe/runtime/regexp` か、そのパッケージ内の相対 import の `…/regexp`)。 */
const ESCAPE_SOURCE = /^(?:@kaninabe\/runtime\/regexp|\.{1,2}\/(?:.*\/)?regexp)$/;

/**
 * `escapeRegExp(…)` の呼び出しか(import の束縛で見る。自前の同名関数は認めない)。
 *
 * @param {import("estree").Node} node - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @returns {boolean} エスケープ部品の呼び出しなら true
 */
function isEscapeCall(node, scope) {
  if (node.type === "Literal") return node.regex !== undefined;
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return false;
  const variable = findVariable(scope, node.callee.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "ImportBinding" || definition.node.type !== "ImportSpecifier") return false;
  const imported = definition.node.imported.name ?? definition.node.imported.value;
  return imported === "escapeRegExp" && ESCAPE_SOURCE.test(String(definition.parent?.source?.value));
}

/** @type {import("eslint").Rule.RuleModule} */
export const noDynamicRegexp = {
  meta: {
    type: "problem",
    docs: { description: "RegExp のパターンに静的でない値を入れさせない(escapeRegExp を通した部分だけ許す)。ASVS V1.2.9" },
    schema: [],
    messages: {
      dynamic:
        "`RegExp` のパターンが静的に決まらない。利用者の値を正規表現に入れるときは `escapeRegExp`(`@kaninabe/runtime/regexp`)を通す(`new RegExp(`^${escapeRegExp(name)}$`)`)。固定のパターンはリテラルで書く。ASVS V1.2.9。",
      alias: "`RegExp` を呼び出し以外の形(別名・引数・分割代入)で持ち出さない(パターンの検査から外れる)。`new RegExp(…)` を直接書く。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return globalNameVisitors(context, NAMES, (node, _name, via) => {
      if (via === "destructure") return context.report({ node, messageId: "alias" });
      const parent = node.parent;
      if ((parent.type === "NewExpression" || parent.type === "CallExpression") && parent.callee === node) {
        const [pattern] = parent.arguments;
        if (pattern === undefined) return undefined;
        const scope = sourceCode.getScope(parent);
        if (pattern.type !== "SpreadElement" && isStaticString(pattern, scope, 0, isEscapeCall)) return undefined;
        return context.report({ node: parent, messageId: "dynamic" });
      }
      if (parent.type === "BinaryExpression" && parent.operator === "instanceof" && parent.right === node) return undefined;
      // 読んでよい性質だけ許す(`.call` / `.apply` / `.bind`・算出のキーは間接の呼び出しになるので違反。外部レビュー)。
      if (parent.type === "MemberExpression" && parent.object === node && !parent.computed && SAFE_MEMBERS.has(parent.property.name)) return undefined;
      return context.report({ node, messageId: "alias" });
    });
  },
};
