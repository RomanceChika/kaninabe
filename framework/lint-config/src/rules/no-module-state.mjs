/**
 * **サーバーのモジュールの最上位に可変の値を置かない**(点検 13 回目 B13-2)。表と理由は `module-state-table.mjs`。
 *
 * モジュールの変数は全部の要求で共有される。`const memo = new Map(); memo.set('rows', rows)` は、次の利用者へ前の利用者の行を返し、DB に届かないので RLS も効かない。
 * `unstable_cache` を閉じた隣の、枠を使わない同じ害の形である。推測はせず、**許す形を並べて、ほかを全部赤にする**:
 *
 *   - 最上位の `let` / `var`
 *   - 最上位の値の初期化子が閉じた文法の外(`new Map`・`new Set`・`new X`・呼び出し・即時関数・タグつきテンプレート・`await`。オブジェクトや配列の中の入れ子と、分割の既定値も見る)
 *   - `g` / `y` の旗を持つ正規表現(字面も `new RegExp` も。`lastIndex` に前の入力で決まる位置が残り、次の要求の判定が変わる。旗は字句で読めるものだけを通す。点検 14 回目 B14-2)
 *   - クラスの `static` の欄(同じ文法)と `static {}` のブロック
 *   - 最上位の宣言と import / export 以外の文(`if`・`for`・`register(x)`・`namespace`)
 *   - モジュールの名前(import を含む)・グローバル(`globalThis`・`process` など)から届く相手への書き込み(メンバーへの代入・`++`・`delete`・分割代入の左辺・
 *     `for (a.b of …)`・`.set` / `.push` などの書き換え・`Object.assign` / `Reflect.set` の第 1 引数)。関数の中の `const m = memo`・`let m = memo`・`m ?? []`・`for (const m of memo)`・引数の既定値の別名も辿る
 *   - `static` のメソッドとモジュールの直下のオブジェクトのメソッドの `this` への書き込み
 *
 * 例外はファイルと名前で名指す `allow` の行(`{ file, name, why }`)だけで、行は初期化子を許すだけで**書き込みは許さない**。使われない行は腐った行として赤にする。
 * 免除の口はほかに作らない。引数に渡した先の関数の中の書き込み・関数の戻り値の別名・`forEach` の引数は見ない(その相手が最上位の配列やオブジェクトのときの下限。BACKLOG)。
 *
 * 範囲は設定が決める(テストと支援コードは外す)。クライアントの部品も SSR でサーバーの上で動くので範囲に入れる。
 *
 * @oversize 1 本の規則が「最上位の値の文法」と「書き込みの形」を 1 つの訪問で閉じる。表は `module-state-table.mjs` に割ってある。
 * @split-review 値の文法と書き込みの判定を別の規則に割ると、`allow` の行の消費を 2 か所で持つことになり、腐った行の判定が割れるので採らない。
 */

import { importOf, findVariable } from "./require-safe-link.mjs";
import { propertyName, stringValue } from "./redirect-sinks.mjs";
import { INERT_BUILTIN_CALLS, INERT_CONSTRUCTORS, INERT_IMPORTED_CALLS, INERT_LOCAL_FUNCTIONS, INERT_METHODS, MUTATING_BUILTINS, MUTATING_METHODS } from "./module-state-table.mjs";

/** 値を変えずに包むだけの節。 */
const WRAPPERS = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "ChainExpression", "ParenthesizedExpression"]);

/** 初期化子として無条件に通す節(値そのもの・関数・型の宣言)。 */
const INERT_LEAVES = new Set(["Literal", "ArrowFunctionExpression", "FunctionExpression", "Identifier", "ThisExpression", "TemplateElement"]);

/** 宣言の文(値を作らない)。 */
const DECLARATION_STATEMENTS = new Set(["ImportDeclaration", "ExportAllDeclaration", "FunctionDeclaration", "TSDeclareFunction", "TSTypeAliasDeclaration", "TSInterfaceDeclaration", "TSEnumDeclaration", "TSImportEqualsDeclaration", "EmptyStatement"]);

/** 返り値が相手の中身を指す読み出し(`memo.get(k).push(x)` を相手まで辿る)。 */
const ALIASING_READS = new Set(["at", "find", "get"]);

/** 正規表現の旗のうち、`lastIndex` を要求をまたいで持つもの。 */
const STATEFUL_REGEXP_FLAGS = /[gy]/u;

/**
 * 包みを外す。
 *
 * @param {import("estree").Node} node - 式
 * @returns {import("estree").Node} 中身
 */
function unwrap(node) {
  let current = node;
  while (WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

/**
 * ドットの連なりの綴り(`Object.freeze`。読めなければ null)。
 *
 * @param {import("estree").Node} node - 式
 * @returns {string | null} 綴り
 */
function dottedName(node) {
  const inner = unwrap(node);
  if (inner.type === "Identifier") return inner.name;
  if (inner.type !== "MemberExpression" || inner.computed) return null;
  const head = dottedName(inner.object);
  const tail = propertyName(inner);
  return head === null || tail === null ? null : `${head}.${tail}`;
}

/**
 * 呼び出しの連なりの根の識別子(`z.string().max(1)` の `z`)。
 *
 * @param {import("estree").Node} node - 式
 * @returns {import("estree").Identifier | null} 根
 */
function chainRoot(node) {
  const inner = unwrap(node);
  if (inner.type === "Identifier") return inner;
  if (inner.type === "MemberExpression") return chainRoot(inner.object);
  if (inner.type === "CallExpression") return chainRoot(inner.callee);
  return null;
}

/**
 * 呼び出しの連なりの全部のメソッドが表の中か(`z.string().max(1)` の `string` と `max`。計算した鍵は外)。
 *
 * @param {import("estree").Node} node - 呼び出される式
 * @param {readonly string[] | undefined} allowed - 表
 * @returns {boolean} 全部中なら true
 */
function chainAllowed(node, allowed) {
  if (allowed === undefined) return false;
  const inner = unwrap(node);
  if (inner.type === "Identifier") return true;
  if (inner.type === "CallExpression") return chainAllowed(inner.callee, allowed);
  if (inner.type !== "MemberExpression") return false;
  return allowed.includes(propertyName(inner) ?? "") && chainAllowed(inner.object, allowed);
}

/**
 * 名前がその位置で別の宣言に隠されていない組み込みか。
 *
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {string | null} dotted - ドットの綴り
 * @returns {boolean} 組み込みなら true
 */
function isBuiltin(scope, dotted) {
  if (dotted === null) return false;
  const variable = findVariable(scope, dotted.split(".")[0] ?? "");
  return variable === null || variable.defs.length === 0;
}

/**
 * 正規表現の字面が `lastIndex` を持たないか。
 *
 * @param {import("estree").Node} node - 字面
 * @returns {boolean} 正規表現で `g` / `y` を持つなら true
 */
function statefulRegExpLiteral(node) {
  return node.type === "Literal" && typeof node.regex?.flags === "string" && STATEFUL_REGEXP_FLAGS.test(node.regex.flags);
}

/**
 * 書き換えられない値の字面か(文字列・数・真偽・`null`・`undefined`)。
 *
 * @param {import("estree").Node} node - 式
 * @returns {boolean} 中身を持たない字面なら true
 */
function primitiveValue(node) {
  const inner = unwrap(node);
  if (inner.type === "Identifier") return inner.name === "undefined";
  return inner.type === "Literal" && inner.regex === undefined;
}

/**
 * `new RegExp` の旗が字句で読めて、`g` / `y` を持たないか。読めない旗は外(閉じる側)。
 *
 * @param {readonly import("estree").Node[]} args - 引数
 * @returns {boolean} 旗なし、または読めて持たないなら true
 */
function statelessRegExpFlags(args) {
  const flags = args[1];
  if (flags === undefined) return true;
  const text = stringValue(unwrap(flags));
  return args.length === 2 && text !== null && !STATEFUL_REGEXP_FLAGS.test(text);
}

/**
 * 呼び出しが表の中か(相手と引数は別に見る)。
 *
 * @param {import("estree").CallExpression} node - 呼び出し
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {boolean} 表の中なら true
 */
function inertCallee(node, scope) {
  const dotted = dottedName(node.callee);
  if (dotted !== null && INERT_BUILTIN_CALLS.has(dotted) && isBuiltin(scope, dotted)) return true;
  const local = dotted === null ? undefined : findVariable(scope, dotted)?.defs[0];
  if (dotted !== null && INERT_LOCAL_FUNCTIONS.has(dotted) && local?.type === "FunctionName") return true;
  const root = chainRoot(node.callee);
  const binding = root === null ? null : importOf(scope, root.name);
  const row = binding === null ? undefined : INERT_IMPORTED_CALLS.get(binding.module);
  if (row !== undefined && binding !== null) {
    const named = row.names === null || row.names.includes(binding.imported ?? "");
    const direct = unwrap(node.callee).type === "Identifier";
    if (row.primitiveArguments?.includes(binding.imported ?? "") && !node.arguments.every(primitiveValue)) return false;
    if (named && (direct || chainAllowed(node.callee, row.chain))) return true;
  }
  const callee = unwrap(node.callee);
  return callee.type === "MemberExpression" && INERT_METHODS.has(propertyName(callee) ?? "") && inertValue(callee.object, scope);
}

/**
 * クラスの `static` の部品が閉じた文法の中か。
 *
 * @param {import("estree").ClassBody} body - クラスの本体
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {boolean} 全部中なら true
 */
function inertClassBody(body, scope) {
  return body.body.every((member) => {
    if (member.type === "StaticBlock") return false;
    if (member.type !== "PropertyDefinition" || member.static !== true || member.value === null) return true;
    return inertValue(member.value, scope);
  });
}

/**
 * 初期化子が閉じた文法の中か(**知らない節は外**)。
 *
 * @param {import("estree").Node | null | undefined} node - 式
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {boolean} 中なら true
 */
function inertValue(node, scope) {
  if (node === null || node === undefined) return true;
  const inner = unwrap(node);
  if (statefulRegExpLiteral(inner)) return false;
  if (INERT_LEAVES.has(inner.type)) return true;
  const each = (nodes) => nodes.every((item) => inertValue(item, scope));
  switch (inner.type) {
    case "TemplateLiteral":
      return each(inner.expressions);
    case "ArrayExpression":
      return each(inner.elements);
    case "SpreadElement":
    case "UnaryExpression":
      return inner.type === "UnaryExpression" && inner.operator === "delete" ? false : inertValue(inner.argument, scope);
    case "ObjectExpression":
      return inner.properties.every((property) => (property.type === "SpreadElement" ? inertValue(property.argument, scope) : inertValue(property.value, scope) && (!property.computed || inertValue(property.key, scope))));
    case "BinaryExpression":
    case "LogicalExpression":
      return inertValue(inner.left, scope) && inertValue(inner.right, scope);
    case "ConditionalExpression":
      return inertValue(inner.test, scope) && inertValue(inner.consequent, scope) && inertValue(inner.alternate, scope);
    case "MemberExpression":
      return inertValue(inner.object, scope) && (!inner.computed || inertValue(inner.property, scope));
    case "ClassExpression":
      return inertClassBody(inner.body, scope);
    case "NewExpression":
      return INERT_CONSTRUCTORS.has(dottedName(inner.callee) ?? "") && isBuiltin(scope, dottedName(inner.callee)) && statelessRegExpFlags(inner.arguments) && each(inner.arguments);
    case "CallExpression":
      return inertCallee(inner, scope) && each(inner.arguments);
    default:
      return false;
  }
}

/**
 * 分割の左辺に含まれるメンバーの参照を集める。
 *
 * @param {import("estree").Node | null} pattern - 左辺
 * @returns {readonly import("estree").Node[]} メンバーの参照
 */
function patternTargets(pattern) {
  if (pattern === null) return [];
  const inner = unwrap(pattern);
  switch (inner.type) {
    case "MemberExpression":
      return [inner];
    case "ArrayPattern":
      return inner.elements.flatMap(patternTargets);
    case "ObjectPattern":
      return inner.properties.flatMap((property) => patternTargets(property.type === "RestElement" ? property.argument : property.value));
    case "AssignmentPattern":
      return patternTargets(inner.left);
    case "RestElement":
      return patternTargets(inner.argument);
    default:
      return [];
  }
}

/**
 * 分割の左辺の既定値を集める(`const [memo = new Map()] = []`)。
 *
 * @param {import("estree").Pattern | null} pattern - 左辺
 * @returns {readonly import("estree").Node[]} 既定値の式
 */
function patternDefaults(pattern) {
  if (pattern === null) return [];
  switch (pattern.type) {
    case "ArrayPattern":
      return pattern.elements.flatMap(patternDefaults);
    case "ObjectPattern":
      return pattern.properties.flatMap((property) => patternDefaults(property.type === "RestElement" ? property.argument : property.value));
    case "AssignmentPattern":
      return [pattern.right, ...patternDefaults(pattern.left)];
    default:
      return [];
  }
}

/**
 * `this` がモジュールの生きている間ずっと残る相手(クラスの `static`・モジュールの直下のオブジェクト)か。
 *
 * @param {import("estree").Node} node - `this`
 * @returns {string | null} 表示名(残らない相手は null)
 */
function persistentThis(node) {
  for (let current = node.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "StaticBlock") return "static の this";
    if (current.type === "PropertyDefinition") return current.static === true ? "static の this" : null;
    if (current.type !== "FunctionExpression") {
      if (current.type === "FunctionDeclaration") return null;
      continue;
    }
    const owner = current.parent;
    if (owner.type === "MethodDefinition") return owner.static === true ? "static の this" : null;
    if (owner.type !== "Property") return null;
    for (let outer = owner.parent; outer !== undefined && outer !== null; outer = outer.parent) {
      if (outer.type === "FunctionExpression" || outer.type === "FunctionDeclaration" || outer.type === "ArrowFunctionExpression") return null;
    }
    return "モジュールの直下のオブジェクトの this";
  }
  return null;
}

/**
 * 書き込みの相手を根まで辿り、モジュールの生きている間ずっと残る名前なら返す。
 *
 * @param {import("estree").Node | null | undefined} node - 相手の式
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {number} depth - 辿った段数
 * @returns {string | null} 名前(関数の中の値なら null)
 */
function persistentRoot(node, scope, depth = 0) {
  if (node === null || node === undefined || depth > 8) return null;
  const inner = unwrap(node);
  if (inner.type === "ThisExpression") return persistentThis(inner);
  if (inner.type === "MemberExpression") return persistentRoot(inner.object, scope, depth);
  if (inner.type === "CallExpression") {
    const callee = unwrap(inner.callee);
    return callee.type === "MemberExpression" && ALIASING_READS.has(propertyName(callee) ?? "") ? persistentRoot(callee.object, scope, depth) : null;
  }
  if (inner.type === "LogicalExpression") return persistentRoot(inner.left, scope, depth) ?? persistentRoot(inner.right, scope, depth);
  if (inner.type === "ConditionalExpression") return persistentRoot(inner.consequent, scope, depth) ?? persistentRoot(inner.alternate, scope, depth);
  if (inner.type !== "Identifier") return null;
  const variable = findVariable(scope, inner.name);
  if (persistentBinding(variable)) return inner.name;
  const source = aliasSource(variable.defs[0]);
  return source === null ? null : persistentRoot(source, variable.scope, depth + 1);
}

/**
 * 束縛がモジュールの生きている間ずっと残るか(モジュールの名前・import・グローバル)。
 *
 * @param {import("eslint").Scope.Variable | null} variable - 束縛
 * @returns {boolean} 残るなら true
 */
function persistentBinding(variable) {
  return variable === null || variable.defs.length === 0 || variable.scope.type === "module" || variable.scope.type === "global";
}

/**
 * ローカルの束縛が別名になる相手の式(`const` / `let` の初期化子・`for of` の相手・引数の既定値)。
 *
 * @param {import("eslint").Scope.Definition | undefined} definition - 束縛の定義
 * @returns {import("estree").Node | null} 相手(無ければ null)
 */
function aliasSource(definition) {
  if (definition?.type === "Parameter") {
    const owner = definition.name.parent;
    return owner?.type === "AssignmentPattern" && owner.left === definition.name ? owner.right : null;
  }
  if (definition?.type !== "Variable" || definition.parent?.kind === "var") return null;
  const loop = definition.parent.parent;
  if (loop?.type === "ForOfStatement" && loop.left === definition.parent) return loop.right;
  return definition.node.init ?? null;
}

/**
 * 宣言の束縛の名前を集める。
 *
 * @param {import("estree").Pattern} pattern - 左辺
 * @returns {readonly string[]} 名前
 */
function boundNames(pattern) {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => (element === null ? [] : boundNames(element)));
    case "ObjectPattern":
      return pattern.properties.flatMap((property) => boundNames(property.type === "RestElement" ? property.argument : property.value));
    case "AssignmentPattern":
      return boundNames(pattern.left);
    case "RestElement":
      return boundNames(pattern.argument);
    default:
      return [];
  }
}

/** @type {import("eslint").Rule.RuleModule} */
export const noModuleState = {
  meta: {
    type: "problem",
    docs: { description: "サーバーのモジュールの最上位に可変の値を置かない。許す形の外は全部赤で、例外は理由つきの行だけ" },
    schema: [{
      type: "object",
      properties: {
        allow: {
          type: "array",
          items: {
            type: "object",
            properties: { file: { type: "string" }, name: { type: "string" }, why: { type: "string", minLength: 1 } },
            required: ["file", "name", "why"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    }],
    messages: {
      letBinding: "モジュールの最上位の `{{name}}` に `let` / `var` は使えません。モジュールの変数は全部の要求で共有され、別の利用者へ値が渡ります。要求の中の memo は `react` の `cache`。",
      value: "モジュールの最上位の `{{name}}` の初期化は閉じた表の外です。`Map` / `Set` / インスタンス / 呼び出しの戻り値は要求をまたいで値を持ち、`g` / `y` の正規表現は `lastIndex` に前の入力の位置を残して次の要求の判定を変えるので(`g` / `y` は関数の中で作る)、要るなら `module-state-table.mjs` か設定の `allow` に理由つきの行を足す(要求の中の memo は `react` の `cache`)。",
      statement: "モジュールの最上位に置ける文は宣言と import / export だけです(読み込みのときの処理は要求をまたぐ状態を作れる)。",
      write: "`{{name}}` はモジュールの生きている間ずっと残る相手です。ここに書くと全部の要求で共有され、別の利用者へ値が渡ります。",
      staleRow: "`allow` の行 `{{name}}` はこのファイルで使われていません(腐った行は消す)。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const rows = (context.options[0]?.allow ?? []).filter((row) => row.file === context.physicalFilename);
    const used = new Set();

    /**
     * 名前が行で許されているか(使ったことも記録する)。
     *
     * @param {string} name - 名前
     * @returns {boolean} 許されていれば true
     */
    function allowed(name) {
      if (!rows.some((row) => row.name === name)) return false;
      used.add(name);
      return true;
    }

    /**
     * 書き込みの相手を見る。
     *
     * @param {import("estree").Node} site - 報告の位置
     * @param {import("estree").Node} target - 相手の式
     */
    function checkWrite(site, target) {
      const name = persistentRoot(target, sourceCode.getScope(site));
      if (name !== null) context.report({ node: site, messageId: "write", data: { name } });
    }

    /**
     * 最上位の変数の宣言を見る。
     *
     * @param {import("estree").VariableDeclaration} node - 宣言
     * @param {import("eslint").Scope.Scope} scope - モジュールのスコープ
     */
    function checkVariables(node, scope) {
      if (node.declare === true) return;
      for (const declarator of node.declarations) {
        const names = boundNames(declarator.id);
        const defaultsInert = patternDefaults(declarator.id).every((value) => inertValue(value, scope));
        if (node.kind !== "const") for (const name of names) context.report({ node: declarator, messageId: "letBinding", data: { name } });
        else if (!(defaultsInert && inertValue(declarator.init, scope)) && !names.every(allowed)) context.report({ node: declarator, messageId: "value", data: { name: names.join(", ") } });
      }
    }

    /**
     * クラスの `static` を見る。
     *
     * @param {import("estree").ClassDeclaration} node - クラス
     * @param {import("eslint").Scope.Scope} scope - モジュールのスコープ
     */
    function checkClass(node, scope) {
      const label = node.id?.name ?? "default";
      for (const member of node.body.body) {
        const name = `${label}.${member.key?.name ?? "static {}"}`;
        const isStatic = member.type === "StaticBlock" || (member.type === "PropertyDefinition" && member.static === true);
        if (isStatic && !inertClassBody({ body: [member] }, scope) && !allowed(name)) context.report({ node: member, messageId: "value", data: { name } });
      }
    }

    /**
     * 最上位の文を見る。
     *
     * @param {import("estree").Node} node - 文
     * @param {import("eslint").Scope.Scope} scope - モジュールのスコープ
     */
    function checkStatement(node, scope) {
      if (DECLARATION_STATEMENTS.has(node.type)) return;
      if (node.declare === true) return;
      switch (node.type) {
        case "VariableDeclaration":
          return checkVariables(node, scope);
        case "ClassDeclaration":
          return checkClass(node, scope);
        case "ExportNamedDeclaration":
          if (node.declaration !== null && node.declaration !== undefined) checkStatement(node.declaration, scope);
          return undefined;
        case "ExportDefaultDeclaration": {
          const value = node.declaration;
          if (value.type === "FunctionDeclaration" || value.type === "TSDeclareFunction") return undefined;
          if (value.type === "ClassDeclaration") return checkClass(value, scope);
          if (!inertValue(value, scope) && !allowed("default")) context.report({ node, messageId: "value", data: { name: "default" } });
          return undefined;
        }
        case "ExpressionStatement": {
          const inner = unwrap(node.expression);
          const voidName = inner.type === "UnaryExpression" && inner.operator === "void" && unwrap(inner.argument).type === "Identifier";
          if (typeof node.directive !== "string" && !voidName) context.report({ node, messageId: "statement" });
          return undefined;
        }
        default:
          context.report({ node, messageId: "statement" });
          return undefined;
      }
    }

    return {
      Program(node) {
        const top = sourceCode.getScope(node);
        const scope = top.childScopes.find((child) => child.type === "module") ?? top;
        for (const statement of node.body) checkStatement(statement, scope);
      },
      "Program:exit"(node) {
        for (const row of rows) if (!used.has(row.name)) context.report({ node, messageId: "staleRow", data: { name: row.name } });
      },
      AssignmentExpression(node) {
        for (const target of patternTargets(node.left)) checkWrite(node, target);
        const left = unwrap(node.left);
        // 名前そのものへの代入は束縛を差し替えるだけで、別名の先には書かない(`let m = memo; m = []`)。
        if (left.type === "Identifier" && persistentBinding(findVariable(sourceCode.getScope(node), left.name))) checkWrite(node, left);
      },
      UpdateExpression(node) {
        if (unwrap(node.argument).type === "MemberExpression") checkWrite(node, node.argument);
      },
      UnaryExpression(node) {
        if (node.operator === "delete") checkWrite(node, node.argument);
      },
      ForInStatement(node) {
        for (const target of patternTargets(node.left)) checkWrite(node, target);
      },
      ForOfStatement(node) {
        for (const target of patternTargets(node.left)) checkWrite(node, target);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== "MemberExpression") return;
        const dotted = dottedName(callee);
        if (dotted !== null && MUTATING_BUILTINS.has(dotted) && isBuiltin(sourceCode.getScope(node), dotted)) {
          if (node.arguments[0] !== undefined) checkWrite(node, node.arguments[0]);
          return;
        }
        const method = propertyName(callee) ?? (callee.computed ? stringValue(callee.property) : null);
        if (method !== null && MUTATING_METHODS.has(method)) checkWrite(node, callee.object);
      },
    };
  },
};
