/**
 * OS コマンドを起動する口(`child_process`)を、製品の実行コードから**引かせない**(ASVS V1.2.5。OS コマンドの注入)。
 *
 * **2 つのモード**(範囲は設定側が決める。`allowImport` の有無):
 *   - **既定(`allowImport: false`)**: `child_process` / `node:child_process` を引く形はすべて違反。静的 import・
 *     `export … from`・動的 `import()`・`require()`・`import x = require()`。アプリの `src` と仕組み側の実行コード
 *     (`framework/<パッケージ>/src`)に掛ける。**許可の住所は無い**(実行コードがシェル・子プロセスを起動する理由は無い)。
 *   - **道具の木(`allowImport: true`)**: 開発の道具(アプリの `scripts` / `e2e` と、仕組み側の `scripts` / `testing` / `tools`)には
 *     `child_process` を認める代わりに、**引数の配列で呼ぶ形だけ**に絞る(「使うなら引数を全部検査し、許可した処理だけ」の保険)。
 *     許すのは `spawn` / `spawnSync` / `execFile` / `execFileSync` / `fork` の静的 import の束縛からの呼び出しだけ。
 *     `exec` / `execSync`(シェルを通す)・`shell` オプション(`false` のリテラル以外)・オプションが静的に読めない形
 *     (展開 `...x`・読めない変数)・動的 `import()` / `require()`・名前空間の import を値として持ち出す形は違反。
 *
 * 範囲: これは**字面の検査**で、コマンドの引数に何を渡すかまでは見ない(渡す値の検査は呼び出し側の責任)。
 * **下限として残る形**: `process.binding('spawn_sync')` などの内部の口・計算した指定子の動的 import(`import(x)`)・
 * 文字列を組み立てた `require`。
 */

import { findVariable, memberName } from "./no-external-network.mjs";
import { moduleVisitors } from "./danger-helpers.mjs";

/** 対象のモジュール。 */
const MODULES = new Set(["child_process"]);

/** シェルを通す関数(道具の木でも禁止)。 */
const SHELL_FUNCTIONS = new Set(["exec", "execSync"]);

/** 引数の配列で呼ぶ関数(道具の木で許す)。 */
const ARRAY_FUNCTIONS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "fork"]);

/**
 * `child_process` の静的 import の束縛を指す識別子か、その種類を返す。
 *
 * @param {import("estree").Identifier} ref - 識別子
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @returns {{ kind: "named", name: string } | { kind: "namespace" } | null} 束縛の種類
 */
function bindingOf(ref, scope) {
  const variable = findVariable(scope, ref.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "ImportBinding") return null;
  const source = definition.parent?.source?.value;
  if (typeof source !== "string" || !MODULES.has(source.replace(/^node:/, ""))) return null;
  if (definition.node.type === "ImportSpecifier") return { kind: "named", name: definition.node.imported.name ?? definition.node.imported.value };
  return { kind: "namespace" };
}

/**
 * オプションとして渡された引数が、`shell` を開けていないと静的に言えるか。
 *
 * @param {import("estree").Node} node - 引数
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @returns {boolean} 安全と言えるなら true(配列・関数・`shell` の無い/`false` のオブジェクト)
 */
function optionIsSafe(node, scope) {
  if (node.type === "ArrayExpression" || node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true;
  if (node.type === "Identifier") {
    const variable = findVariable(scope, node.name);
    const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
    // 残余引数(`...args`)は必ず配列で、オプションになりえない。
    if (definition?.name.parent?.type === "RestElement") return true;
    if (definition?.type !== "Variable" || definition.parent?.kind !== "const" || !definition.node.init) return false;
    return optionIsSafe(definition.node.init, variable.scope);
  }
  if (node.type === "ConditionalExpression") return optionIsSafe(node.consequent, scope) && optionIsSafe(node.alternate, scope);
  if (node.type !== "ObjectExpression") return false;
  return node.properties.every((property) => {
    if (property.type !== "Property") return false;
    const name = memberName({ computed: property.computed, property: property.key });
    if (name === null) return false;
    if (name !== "shell") return true;
    return property.value.type === "Literal" && property.value.value === false;
  });
}

/** @type {import("eslint").Rule.RuleModule} */
export const noOsCommand = {
  meta: {
    type: "problem",
    docs: {
      description: "child_process を実行コードから引かせない(道具の木では引数の配列の呼び出しだけ許す)。ASVS V1.2.5",
    },
    schema: [{ type: "object", properties: { allowImport: { type: "boolean" } }, additionalProperties: false }],
    messages: {
      import:
        "`child_process` を引かない(OS コマンドの注入の口になる。ASVS V1.2.5)。実行コード(アプリと仕組み側の `src`)に子プロセスを起動する理由は無い。開発の道具は `scripts` などの道具の木に置く。",
      dynamic: "道具の木でも `child_process` は静的な `import { execFile } from 'node:child_process'` で引く(動的 import / require は束縛を辿れない)。",
      shell: "`{{name}}` はシェルを通す。`execFile` / `spawn` を引数の配列で呼ぶ(コマンドと引数を分ける)。",
      shellOption: "`shell` オプションを開けない。`shell: false` のリテラルか、オプション自体を書かない。",
      options: "子プロセスの呼び出しのオプションが静的に読めない(展開・読めない変数)。オブジェクトのリテラルで書く。",
      escape: "`child_process` の束縛は、呼び出しの形(`execFile(…)` / `cp.execFile(…)`)以外で持ち出さない(別名・分割代入は検査から外れる)。",
    },
  },
  create(context) {
    const allowImport = context.options[0]?.allowImport === true;
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (!allowImport) {
      return moduleVisitors(context, MODULES, (node) => context.report({ node, messageId: "import" }));
    }
    /** 呼び出しの引数を見る。 */
    const checkCall = (call, name, scope) => {
      if (SHELL_FUNCTIONS.has(name)) return context.report({ node: call, messageId: "shell", data: { name } });
      if (!ARRAY_FUNCTIONS.has(name)) return undefined;
      // 第 3 引数がオプションのリテラルなら、第 2 引数は引数の配列そのもの(オプションにはなりえない)。
      const optionsFollow = call.arguments[2]?.type === "ObjectExpression";
      for (const argument of call.arguments.slice(optionsFollow ? 2 : 1)) {
        if (argument.type === "SpreadElement") return context.report({ node: argument, messageId: "options" });
        if (!optionIsSafe(argument, scope)) {
          const hasShell = argument.type === "ObjectExpression" && argument.properties.some((property) => property.type === "Property" && memberName({ computed: property.computed, property: property.key }) === "shell");
          return context.report({ node: argument, messageId: hasShell ? "shellOption" : "options" });
        }
      }
      return undefined;
    };
    return {
      ...moduleVisitors(context, MODULES, (node, _specifier, kind) => {
        if (kind === "dynamic") context.report({ node, messageId: "dynamic" });
        else if (node.type !== "ImportDeclaration") context.report({ node, messageId: "dynamic" });
      }),
      "CallExpression:exit"(node) {
        const scope = sourceCode.getScope(node);
        const callee = node.callee;
        if (callee.type === "Identifier") {
          const binding = bindingOf(callee, scope);
          if (binding?.kind === "named") checkCall(node, binding.name, scope);
        } else if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
          const binding = bindingOf(callee.object, scope);
          const name = memberName(callee);
          if (binding?.kind === "namespace") {
            if (name === null) context.report({ node: callee, messageId: "escape" });
            else checkCall(node, name, scope);
          }
        }
      },
      Identifier(node) {
        // 束縛を呼び出しの形以外(別名・引数・分割代入の元・値の持ち出し)で参照する形。
        const parent = node.parent;
        if (parent.type === "Property" && parent.key === node && !parent.computed) return;
        if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") return;
        const scope = sourceCode.getScope(node);
        const binding = bindingOf(node, scope);
        if (binding === null || parent.type?.startsWith("TS")) return;
        const isCallee = parent.type === "CallExpression" && parent.callee === node;
        const isMemberObject = parent.type === "MemberExpression" && parent.object === node && !parent.computed;
        const isShellName = binding.kind === "named" && SHELL_FUNCTIONS.has(binding.name);
        if (binding.kind === "named" && isCallee) return;
        if (binding.kind === "namespace" && isMemberObject && parent.parent.type === "CallExpression" && parent.parent.callee === parent) return;
        if (binding.kind === "namespace" && isMemberObject) {
          context.report({ node, messageId: "escape" });
          return;
        }
        context.report({ node, messageId: isShellName ? "shell" : "escape", data: { name: node.name } });
      },
    };
  },
};
