/**
 * 文字列からコードを実行する口を使わせない(ASVS V1.3.2。eval などの動的なコード実行)。
 *
 * 止めるもの:
 *   - `eval`(直接・`(0, eval)(…)`・`window.eval` / `globalThis['eval']`・`const e = eval` の別名・分割代入の取り出し。値の参照ぜんぶ)
 *   - `Function` コンストラクタ(`new Function(…)` / `Function(…)`・`globalThis.Function`)。値としての持ち出しも。`instanceof Function`・
 *     `Function.prototype` は通す
 *   - `setTimeout` / `setInterval` / `setImmediate` の**第 1 引数が文字列**(リテラル・テンプレート・文字列の連結・それを束ねた `const`)
 *   - 関数リテラル・`.constructor.constructor` から `Function` を引く形に文字列を渡す呼び出し(`(() => {}).constructor('return 1')`)
 *   - `vm` / `node:vm` モジュールを引く形(静的 import・再エクスポート・動的 `import()`・`require()`)
 *
 * **束縛で見る**: グローバルの名前が宣言に解決できないときだけ(自前の `eval` / `Function` / `setTimeout` は対象外)。型の位置も対象外。
 * **下限として残る形**: 第 1 引数が型の上でだけ文字列と分かる `setTimeout(code)`(`@typescript-eslint/no-implied-eval` が型で見る)・
 * 計算した鍵(`globalThis[key]`)・`Reflect.get(globalThis, 'eval')`・`import('data:…')`・`new Worker(blob)`。
 */

import { globalNameVisitors, isStringValued, moduleVisitors } from "./danger-helpers.mjs";

/** 間接の呼び出しにならない、読むだけの性質。 */
const SAFE_MEMBERS = new Set(["prototype", "name", "length"]);

/** 対象のグローバル。 */
const NAMES = new Set(["eval", "Function", "setTimeout", "setInterval", "setImmediate"]);

/** 文字列を渡すとコードになるタイマー。 */
const TIMERS = new Set(["setTimeout", "setInterval", "setImmediate"]);

/** @type {import("eslint").Rule.RuleModule} */
export const noDynamicCode = {
  meta: {
    type: "problem",
    docs: { description: "eval / new Function / 文字列つきのタイマー / vm モジュールを使わせない。ASVS V1.3.2" },
    schema: [],
    messages: {
      eval: "`eval` を使わない(文字列がコードとして実行される。ASVS V1.3.2)。別名・`window.eval`・分割代入の取り出しも同じ。",
      function: "`Function` コンストラクタで文字列からコードを作らない(`new Function(…)` は `eval` と同じ。ASVS V1.3.2)。",
      timer: "`{{name}}` に文字列を渡さない(文字列はコードとして実行される)。関数を渡す。ASVS V1.3.2。",
      constructor: "関数の `.constructor(…)` に文字列を渡さない(`Function` コンストラクタと同じ。ASVS V1.3.2)。",
      destructure: "`globalThis` / `window` / `self` から `eval` / `Function` / タイマーを分割代入で取り出さない(取り出した名前は検査から外れる)。",
      vm: "`vm` モジュールを引かない(文字列のコードを実行する口。ASVS V1.3.2)。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const asCallee = (node) => (node.parent.type === "CallExpression" || node.parent.type === "NewExpression") && node.parent.callee === node;
    return {
      ...globalNameVisitors(context, NAMES, (node, name, via) => {
        if (via === "destructure") return context.report({ node, messageId: "destructure" });
        const resolved = via === "reference" ? name : (node.property.name ?? node.property.value);
        if (resolved === "eval") return context.report({ node, messageId: "eval" });
        if (resolved === "Function") {
          const parent = node.parent;
          if (parent.type === "BinaryExpression" && parent.operator === "instanceof" && parent.right === node) return undefined;
          // 読んでよい性質だけ許す(`.call` / `.apply` / `.bind`・算出のキーは間接の呼び出しになるので違反。外部レビュー)。
          if (parent.type === "MemberExpression" && parent.object === node && !parent.computed && SAFE_MEMBERS.has(parent.property.name)) return undefined;
          return context.report({ node, messageId: "function" });
        }
        if (TIMERS.has(resolved) && asCallee(node) && isStringValued(node.parent.arguments[0], sourceCode.getScope(node.parent))) {
          return context.report({ node: node.parent, messageId: "timer", data: { name: resolved } });
        }
        return undefined;
      }),
      ...moduleVisitors(context, new Set(["vm"]), (node) => context.report({ node, messageId: "vm" })),
      // `(() => {}).constructor('…')` / `x.constructor.constructor('…')`: 関数のコンストラクタ(= `Function`)に文字列を渡す形。
      "CallExpression, NewExpression"(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "constructor") return;
        const owner = callee.object;
        const functionLike = owner.type === "FunctionExpression" || owner.type === "ArrowFunctionExpression";
        const viaConstructor = owner.type === "MemberExpression" && !owner.computed && owner.property.name === "constructor";
        if (!functionLike && !viaConstructor) return;
        if (isStringValued(node.arguments[node.arguments.length - 1], sourceCode.getScope(node))) {
          context.report({ node, messageId: "constructor" });
        }
      },
    };
  },
};
