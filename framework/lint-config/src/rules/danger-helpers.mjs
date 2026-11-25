/**
 * 「危ない API」の規則群(`no-os-command` / `no-dynamic-regexp` / `no-dynamic-code` / `no-message-listener` /
 * `no-browser-storage` / `no-console-output`。ASVS V1.2.5・V1.2.9・V1.3.2・V3.5.5・V14.3.3・V13.4.2)が共有する部品。
 *
 * **束縛で見る**(名前では決めない。`no-external-network` / `require-safe-fetch` と同じ考え方): スコープ解析で
 * 「宣言に解決できないグローバルの参照」だけを対象にし、自前の宣言・引数・import の同名は対象外(影になる)。
 * 持ち主(`globalThis` / `window` / `self` / `top` / `parent` / `frames`)の解決は `no-external-network` の
 * `holderKind` を使い回す(TS のラッパ・入れ子・`const` の別名を辿る)。
 *
 * 出すもの:
 *   - `resolvesToGlobal` — ノードが「禁止したいグローバルの名前」を指すか(`eval` / `window.eval` / `(0, eval)` / `const g = eval`)
 *   - `globalNameVisitors` — 参照・メンバ参照・分割代入の 3 つの入口を 1 組の訪問者にまとめる
 *   - `moduleVisitors` — 静的 import / 再エクスポート / 動的 import / `require` / `import x = require()` で名前を指定したモジュールを引く形
 *   - `isStaticString` — 文字列の値が静的に決まるノードか(リテラル・式の無いテンプレート・`+` の連結・`const` の束ね)
 *   - `isStringValued` — 文字列として使われると分かるノードか(`setTimeout("…")` の第 1 引数の判定用)
 */

import { findVariable, holderKind, memberName, unwrap } from "./no-external-network.mjs";

/** グローバルを持つオブジェクト。 */
const GLOBAL_HOLDER_NAMES = new Set(["globalThis", "window", "self", "top", "parent", "frames"]);

/**
 * ノードが、`names` のどれかのグローバルを指すかを返す。
 *
 * 辿る形: 宣言に解決できない識別子(自前の宣言は対象外)・持ち主のメンバ(`window.eval` / `self['eval']`)・
 * TS のラッパ・カンマ式の最後(`(0, eval)`)・初期値が上のどれかの `const` の別名。
 *
 * @param {import("estree").Node} rawNode - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {ReadonlySet<string>} names - 禁止したいグローバルの名前
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @returns {string | null} 指しているグローバルの名前(指さなければ null)
 */
export function resolvesToGlobal(rawNode, scope, names, depth = 0) {
  if (depth > 4) return null;
  const node = unwrap(rawNode);
  if (node.type === "SequenceExpression") {
    return resolvesToGlobal(node.expressions[node.expressions.length - 1], scope, names, depth + 1);
  }
  if (node.type === "MemberExpression") {
    const name = memberName(node);
    if (name === null || !names.has(name)) return null;
    return holderKind(node.object, scope) === "global" ? name : null;
  }
  if (node.type !== "Identifier") return null;
  const variable = findVariable(scope, node.name);
  if (variable === null || variable.defs.length === 0) return names.has(node.name) ? node.name : null;
  const definition = variable.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const") return null;
  if (definition.node.id.type !== "Identifier" || !definition.node.init) return null;
  return resolvesToGlobal(definition.node.init, variable.scope, names, depth + 1);
}

/**
 * 分割代入のパターンが、`names` のどれかを(入れ子の持ち主越しに・`...rest` で・計算した鍵で)取り出しているか。
 *
 * @param {import("estree").Node} pattern - `{ eval, window: { eval: e } }` のようなパターン
 * @param {ReadonlySet<string>} names - 禁止したい名前
 * @returns {boolean} 取り出していれば true
 */
export function patternTakes(pattern, names) {
  if (pattern.type !== "ObjectPattern") return false;
  return pattern.properties.some((property) => {
    if (property.type === "RestElement") return true;
    const computed = property.computed || property.key.type === "Literal";
    const name = memberName({ computed, property: property.key });
    if (name === null) return property.computed;
    if (names.has(name)) return true;
    const inner = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
    return GLOBAL_HOLDER_NAMES.has(name) && patternTakes(inner, names);
  });
}

/**
 * 禁止したいグローバルを見張る訪問者を組む(参照・メンバ参照・分割代入)。
 *
 * `report(node, name, via)` が呼ばれる。`via` は `"reference"`(宣言に解決できない識別子)・`"property"`(持ち主のメンバ)・
 * `"destructure"`(分割代入。`node` はパターン)。型の位置(`typeof x` / 型注釈)は呼ばない。
 *
 * @param {import("eslint").Rule.RuleContext} context - ルールの文脈
 * @param {ReadonlySet<string>} names - 禁止したいグローバルの名前
 * @param {(node: import("estree").Node, name: string, via: "reference" | "property" | "destructure") => void} report - 報告の口
 * @returns {import("eslint").Rule.RuleListener} 訪問者
 */
export function globalNameVisitors(context, names, report) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  const checkDestructure = (pattern, source, node) => {
    if (!source || pattern.type !== "ObjectPattern") return;
    if (holderKind(source, sourceCode.getScope(node)) !== "global") return;
    if (patternTakes(pattern, names)) report(pattern, "", "destructure");
  };
  return {
    Program(program) {
      const scope = sourceCode.getScope(program);
      const global = scope.type === "global" ? scope : scope.upper;
      if (global === null) return;
      const references = [...global.through, ...[...names].flatMap((name) => global.set.get(name)?.references ?? [])];
      const seen = new Set();
      for (const reference of references) {
        const node = reference.identifier;
        if (seen.has(node) || !names.has(node.name)) continue;
        seen.add(node);
        // 自前の宣言(同名の変数・関数・import・引数)を指す参照は対象外。
        if (reference.resolved !== null && reference.resolved.defs.length > 0) continue;
        if (findVariable(sourceCode.getScope(node), node.name)?.defs.length) continue;
        // 型の位置(`typeof eval` / 型注釈)は値の参照ではない。
        if (node.parent?.type === "TSTypeQuery") continue;
        if (reference.isTypeReference === true && reference.isValueReference !== true) continue;
        report(node, node.name, "reference");
      }
    },
    MemberExpression(node) {
      const name = memberName(node);
      if (name === null || !names.has(name)) return;
      if (holderKind(node.object, sourceCode.getScope(node)) !== "global") return;
      report(node, name, "property");
    },
    VariableDeclarator: (node) => checkDestructure(node.id, node.init, node),
    AssignmentExpression: (node) => checkDestructure(node.left, node.right, node),
    AssignmentPattern: (node) => checkDestructure(node.left, node.right, node),
  };
}

/**
 * モジュール指定子を正規化する(`node:` の接頭辞を外す)。
 *
 * @param {unknown} specifier - import / require の指定子
 * @returns {string | null} 正規化した指定子(文字列でなければ null)
 */
function normalizeSpecifier(specifier) {
  if (typeof specifier !== "string") return null;
  return specifier.startsWith("node:") ? specifier.slice(5) : specifier;
}

/**
 * 名前を指定したモジュールを**引く形**(静的 import・再エクスポート・動的 `import()`・`require()`・`import x = require()`)を見張る。
 *
 * `report(node, specifier, kind)` の `kind` は `"import"`(静的 import / 再エクスポート / `import x = require()`)か
 * `"dynamic"`(動的 `import()` / `require()`)。`require` は宣言に解決できないときだけ(自前の `require` は対象外)。
 * 動的 import の指定子が静的に決まらない形(`import(x)`)は見ない(下限として残る)。
 *
 * @param {import("eslint").Rule.RuleContext} context - ルールの文脈
 * @param {ReadonlySet<string>} modules - 禁止したいモジュール名(`node:` なし)
 * @param {(node: import("estree").Node, specifier: string, kind: "import" | "dynamic") => void} report - 報告の口
 * @returns {import("eslint").Rule.RuleListener} 訪問者
 */
export function moduleVisitors(context, modules, report) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  const check = (node, rawSpecifier, kind) => {
    const specifier = normalizeSpecifier(rawSpecifier);
    if (specifier !== null && modules.has(specifier)) report(node, specifier, kind);
  };
  const staticArg = (node) => (node?.type === "Literal" ? node.value : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : undefined);
  return {
    ImportDeclaration: (node) => check(node, node.source.value, "import"),
    ExportNamedDeclaration: (node) => node.source && check(node, node.source.value, "import"),
    ExportAllDeclaration: (node) => check(node, node.source.value, "import"),
    ImportExpression: (node) => check(node, staticArg(node.source), "dynamic"),
    TSImportEqualsDeclaration(node) {
      const reference = node.moduleReference;
      if (reference.type === "TSExternalModuleReference") check(node, staticArg(reference.expression), "import");
    },
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
      if (findVariable(sourceCode.getScope(node), "require")?.defs.length) return;
      check(node, staticArg(node.arguments[0]), "dynamic");
    },
  };
}

/**
 * 文字列の値が静的に決まるノードか(リテラル・式の無い or 式がすべて静的なテンプレート・`+` の連結・
 * 両枝が静的な条件式・初期値が静的な `const` の識別子)。
 *
 * @param {import("estree").Node | undefined} rawNode - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ(識別子を `const` に辿るため)
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @param {((node: import("estree").Node, scope: import("eslint").Scope.Scope) => boolean) | null} accept - 静的とみなす追加の形(例: エスケープ部品の呼び出し)
 * @returns {boolean} 静的な文字列と分かるなら true
 */
export function isStaticString(rawNode, scope, depth = 0, accept = null) {
  if (rawNode === undefined || depth > 4) return false;
  const node = unwrap(rawNode);
  if (accept !== null && accept(node, scope)) return true;
  const again = (inner) => isStaticString(inner, scope, depth + 1, accept);
  if (node.type === "Literal") return typeof node.value === "string";
  if (node.type === "TemplateLiteral") return node.expressions.every(again);
  if (node.type === "BinaryExpression") return node.operator === "+" && again(node.left) && again(node.right);
  if (node.type === "ConditionalExpression") return again(node.consequent) && again(node.alternate);
  if (node.type !== "Identifier") return false;
  const variable = findVariable(scope, node.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const" || !definition.node.init) return false;
  if (definition.node.id.type !== "Identifier") return false;
  return isStaticString(definition.node.init, variable.scope, depth + 1, accept);
}

/**
 * 文字列の値として使われると分かるノードか(文字列リテラル・テンプレート・どちらかが文字列の `+`・それらを束ねた `const`)。
 * `setTimeout("…")` のように「関数のはずの場所に文字列」を見つけるのに使う。
 *
 * @param {import("estree").Node | undefined} rawNode - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @returns {boolean} 文字列と分かるなら true
 */
export function isStringValued(rawNode, scope, depth = 0) {
  if (rawNode === undefined || depth > 4) return false;
  const node = unwrap(rawNode);
  if (node.type === "Literal") return typeof node.value === "string";
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "BinaryExpression") {
    return node.operator === "+" && (isStringValued(node.left, scope, depth + 1) || isStringValued(node.right, scope, depth + 1));
  }
  if (node.type !== "Identifier") return false;
  const variable = findVariable(scope, node.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const" || !definition.node.init) return false;
  if (definition.node.id.type !== "Identifier") return false;
  return isStringValued(definition.node.init, variable.scope, depth + 1);
}
