/**
 * モジュールを読む指定子を**字句**に限る(点検 6 回目 B6-1)。
 *
 * 検査器(spec-tools の import の閉包)は、口やページが有料の連携のアダプタに「届くか」を、指定子の字面から
 * 辿って決める。`` import(`@/composition/${area}/ai`) `` / `import(name)` / `require(x)` は字面から行き先が決まらない
 * ので、閉包からも「handler の外で有料の処理を呼ぶか」の判定からも消えていた(未ログインの要求が有料の連携に
 * 届く形が、verify・ESLint・tsc・生成テストの全部で緑だった)。ここは**許可表**で閉じる —— 通すのは
 *
 *   - 動的 `import()` の指定子が文字列リテラルか、置換の無いテンプレート(`` import(`./x.js`) ``)
 *   - グローバルの `require` を、指定子が同じ形の 1 引数で**直に呼ぶ**形
 *
 * だけで、それ以外(計算した指定子・`const` に束ねた指定子・`require` の持ち出し・`globalThis.require`・
 * 分割代入・`node:module` の `createRequire`・`process.getBuiltinModule` / `process.binding`(点検 11 回目 B11-7。外へ送る口の閉じた表の外から
 * `node:https` を取れる))は違反である。`const` に束ねた静的な文字列も通さない —— 閉包の側
 * (`import-graph.ts`)が字面しか読まないので、「静的に決まる」ではなく「字句である」に揃える。
 *
 * 自前の宣言の `require`(引数・変数)は対象外(束縛で見る。`danger-helpers.mjs` の `globalNameVisitors`)。
 * 範囲は設定側(テストと支援コードを除く製品の実行コード)。
 */

import { globalNameVisitors, moduleVisitors, patternTakes, resolvesToGlobal } from "./danger-helpers.mjs";
import { memberName } from "./no-external-network.mjs";

/** 見張るグローバル。 */
const REQUIRE = new Set(["require"]);

/** `process` のグローバルの名前。 */
const PROCESS = new Set(["process"]);

/** `process` の、組み込みのモジュールを字句の import の外で取り出す口。 */
const BUILTIN_LOADERS = new Set(["getBuiltinModule", "binding"]);

/** `createRequire` を持つモジュール(`node:` なし)。 */
const MODULE_LOADERS = new Set(["module"]);

/**
 * 指定子が字句か(文字列リテラル・置換の無いテンプレート)。TS のラッパ(`as` / `!` / 括弧)も字句ではない扱い。
 *
 * @param {import("estree").Node | undefined} node - 指定子のノード
 * @returns {boolean} 字句なら true
 */
export function isLexicalSpecifier(node) {
  if (node === undefined) return false;
  if (node.type === "Literal") return typeof node.value === "string";
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noOpaqueModuleSpecifier = {
  meta: {
    type: "problem",
    docs: { description: "動的 import と require の指定子を字句に限る(import の閉包が行き先を読めるように)。点検 6 回目 B6-1" },
    schema: [],
    messages: {
      dynamicImport:
        "動的 `import()` の指定子が字句ではない。行き先を字面で書く(`import('@/composition/x/ai')`)。計算した指定子は検査器の import の閉包から消え、有料の連携や認可の迂回が見えなくなる。",
      require:
        "`require` は、字句の指定子 1 つで直に呼ぶ形(`require('x')`)だけにする。計算した指定子・別名・持ち出しは import の閉包から消える。",
      createRequire: "`node:module`(`createRequire`)を製品の実行コードで使わない。モジュールは字句の指定子の `import` で読む。",
      builtinLoader: "`process.getBuiltinModule` / `process.binding` を製品の実行コードで使わない。組み込みのモジュールは字句の指定子の `import` で読む(import の閉包と外へ送る口の表から消える)。",
    },
  },
  create(context) {
    const loaders = moduleVisitors(context, MODULE_LOADERS, (node) => context.report({ node, messageId: "createRequire" }));
    const requires = globalNameVisitors(context, REQUIRE, (node, _name, via) => {
      const parent = node.parent;
      const direct = via === "reference" && parent.type === "CallExpression" && parent.callee === node;
      if (direct && parent.arguments.length === 1 && isLexicalSpecifier(parent.arguments[0])) return undefined;
      return context.report({ node: direct ? parent : node, messageId: "require" });
    });
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      ...requires,
      MemberExpression(node) {
        requires.MemberExpression(node);
        const name = memberName(node);
        if (name !== null && BUILTIN_LOADERS.has(name) && resolvesToGlobal(node.object, sourceCode.getScope(node), PROCESS)) context.report({ node, messageId: "builtinLoader" });
      },
      VariableDeclarator(node) {
        requires.VariableDeclarator(node);
        if (node.init && patternTakes(node.id, BUILTIN_LOADERS) && resolvesToGlobal(node.init, sourceCode.getScope(node), PROCESS)) context.report({ node: node.id, messageId: "builtinLoader" });
      },
      ImportDeclaration: loaders.ImportDeclaration,
      ExportNamedDeclaration: loaders.ExportNamedDeclaration,
      ExportAllDeclaration: loaders.ExportAllDeclaration,
      TSImportEqualsDeclaration: loaders.TSImportEqualsDeclaration,
      CallExpression: loaders.CallExpression,
      ImportExpression(node) {
        loaders.ImportExpression(node);
        if (!isLexicalSpecifier(node.source)) context.report({ node, messageId: "dynamicImport" });
      },
    };
  },
};
