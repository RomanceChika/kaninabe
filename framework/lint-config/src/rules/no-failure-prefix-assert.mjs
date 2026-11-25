/**
 * テストが失敗を「`X に失敗しました`」の**頭の字面だけ**で見分ける形を止める(fix19 の統合の赤 12 件の再発防止・点検 20 回目 C20-6 で照合の形を広げた)。
 *
 * `rejects.toThrow(/widgets の取得に失敗しました/)` は、どの失敗かを見ていない。RLS の拒否(42501)も、通信の失敗も、
 * ガードの例外(P0001)も、同じ頭の字面なら緑になる。逆に、失敗の作り方の字面を直しただけ(点検 19 回目 B19-1 の
 * `dbFailure`: `where` と「に失敗しました」の間の空白・DB の文言を `cause` へ)で、何も壊れていないのに赤になる。
 * B19-1 の 89 か所の置き換えは pre-commit(単体テストと lint)を通ったが、字面で合わせた統合テスト 12 件だけが赤になった。
 *
 * 失敗は**欄で見分ける**: `rejects.toMatchObject({ name: 'DbInfrastructureError', where: 'widgets の取得', sqlstate: '42501' })`。
 * DB が上げた理由まで確かめるときは `cause: { message: expect.stringMatching(…) }`。DB の文言を含まない診断の `Error` なら、
 * 頭でなく**理由の部分**(`未ログインではシートを読めません` など)を合わせる。
 *
 * 止める形: 字面(文字列か正規表現のリテラル・式の無いテンプレート。正規表現なら本体)が**頭だけ**で終わるもの —— 末尾が `に失敗` /
 * `に失敗しました`(後ろの `。`・空白・正規表現の `$` は無視する)。字面を受ける口は次の全部:
 * - 照合の引数: `toThrow` / `toThrowError` / `toMatch` / `toContain` / `toBe` / `toEqual` / `toStrictEqual`(`expect(err.message).toMatch(/…に失敗しました/)` も)
 * - 非対称の照合: `expect.stringContaining(…)` / `expect.stringMatching(…)`(`toMatchObject({ message: expect.stringContaining('に失敗しました') })` も)
 * - 欄の照合: `toMatchObject` / `toEqual` / `toStrictEqual` の引数の中の `message: '…に失敗しました'`・`toHaveProperty('message', '…に失敗しました')`
 * - 文字列の照合の関数: `startsWith` / `includes` / `endsWith`(`expect(e.message.startsWith('…に失敗しました')).toBe(true)`。点検 21 回目 C21-7)と、
 *   正規表現の `.test(…)` の受け手(`expect(/…に失敗しました$/.test(e.message)).toBe(true)`。点検 22 回目 C22-5)。**`expect(…)` の引数の中で、
 *   関数をまたがずに呼ぶときだけ**照合の口に数える(`lines.filter((l) => l.includes('…に失敗しました'))` の「失敗の文が無い」を数える
 *   正しい試験を赤にしない。点検 22 回目 C22-5 の誤検知)
 * - 照合に渡す `Error` の値: `rejects.toThrowError(new Error('…に失敗しました'))` / `toThrow(new Error(…))` / `toEqual(new Error(…))` の第 1 引数(点検 22 回目 C22-5)
 * - `node:assert` の口(点検 23 回目 C23-4): `assert.match` / `equal` / `strictEqual` / `deepEqual` / `deepStrictEqual` / `throws` / `rejects` の**第 2 引数**(第 1 引数は実際の値)。
 *   口は**名前でなく import の束縛**から決める(点検 24 回目 C24-4。`ASSERT_MODULES` の既定・名前空間・`strict`・名前つきの照合の import と別名、`.strict`、`t.assert`、
 *   束縛の無い大域の `assert`。手元の同名の値は数えない)。`assert(…)` / `assert.ok(…)` など口への呼び出しの引数の中は `expect(…)` の引数と同じ照合の文脈
 * - 正規表現の受け手の `.test(…)` / `.exec(…)`: 受け手がリテラルの正規表現のほか、`new RegExp(字面)` / `RegExp(字面)`(`expect(new RegExp('…に失敗しました').test(e.message))`)
 * - 文字列の `match(…)`(`expect(e.message.match(/…に失敗しました/))`)
 * 理由が後ろに続く字面(`… に失敗しました: 未ログインでは…`)は対象外。
 *
 * 下限(追わない形。点検 23 回目 C23-4): 字面を変数・定数に束ねてから照合に渡す形、文字列の連結・テンプレートの式(`'に' + '失敗しました'`・`new RegExp(\`${where}に失敗しました\`)`)、
 * 照合を自前の関数に包む形。照合の口は下の閉じた表(`CALL_SHAPES`)で持ち、口を足すときはその表に 1 行足す(規則の本体は広げない)。
 */

/**
 * 照合の口の閉じた表(点検 23 回目 C23-4)。口は「どの綴りの呼び出しが、どの位置の字面を照合に使うか」の 3 つの形だけ。
 * - `assertNamespace`: `assert.<名前>(実際の値, 字面)` の第 2 引数(どこで呼んでも照合)。口の束縛は `ASSERT_MODULES` の import から決める。
 * - `receiver`: `<正規表現>.<名前>(…)` の受け手の字面(`expect(…)` の引数の中で、関数をまたがずに呼ぶときだけ)。
 * - 以降の `ASSERTERS` などは `expect(…)` の後の照合の口。
 */
const CALL_SHAPES = {
  assertNamespace: new Set(["match", "equal", "strictEqual", "deepEqual", "deepStrictEqual", "throws", "rejects"]),
  receiver: new Set(["test", "exec"]),
};

/**
 * `node:assert` の口を作る import の閉じた表(モジュール → 名前空間になる名前つきの束縛)。既定と名前空間の import は全部が名前空間(vitest は chai の
 * `assert` だけで既定を持たない)。名前つきの `CALL_SHAPES.assertNamespace` の名前は照合の関数そのもの、それ以外(`ok` など)は口への呼び出し。
 */
const ASSERT_MODULES = new Map([...["node:assert", "node:assert/strict", "assert", "assert/strict"].map((name) => [name, new Set(["strict"])]), ["vitest", new Set(["assert"])]]);

/** 名前空間の中の、同じ口の名前空間(`assert.strict` / node:test の文脈の `t.assert`)。 */
const NESTED_NAMESPACE = new Set(["strict", "assert"]);

/** 字面を引数に取る照合(`expect(…)` の後の照合の口。どこで呼んでも照合)。 */
const ASSERTERS = new Set(["toThrow", "toThrowError", "toMatch", "toContain", "toBe", "toEqual", "toStrictEqual"]);

/**
 * 文字列の照合の関数(`startsWith` / `includes` / `endsWith`)。`expect(e.message.startsWith('…に失敗しました')).toBe(true)` は頭の字面だけで
 * 見分ける同じ形である(点検 21 回目 C21-7)。ただし照合の口になるのは `expect(…)` の引数の中で関数をまたがずに呼ぶときだけ
 * (点検 22 回目 C22-5。`filter` の中の `includes` は数えるだけで照合でない)。
 */
const STRING_MATCHERS = new Set(["startsWith", "includes", "endsWith", "match"]);

/** `Error` の値を受ける照合(`toThrowError(new Error('…'))`。点検 22 回目 C22-5)。 */
const ERROR_ASSERTERS = new Set(["toThrow", "toThrowError", "toEqual", "toStrictEqual", "toMatchObject"]);

/** 欄の名前と値を引数に取る照合(`toHaveProperty('message', '…')`。点検 21 回目 C21-7)。 */
const PROPERTY_ASSERTER = "toHaveProperty";

/** 欄(`message`)の字面を中に持てる照合。 */
const OBJECT_ASSERTERS = new Set(["toMatchObject", "toEqual", "toStrictEqual"]);

/** 非対称の照合(`expect.<名前>(字面)`)。 */
const ASYMMETRIC = new Set(["stringContaining", "stringMatching"]);

/** 頭だけの字面(末尾が「に失敗」か「に失敗しました」。後ろの句点・空白・正規表現の末尾の `$` は無視する)。 */
const PREFIX_ONLY = /に失敗(?:しました)?[。.]?\s*\$?$/u;

/**
 * 引数の字面(文字列か正規表現のリテラル・式の無いテンプレート)。それ以外は `undefined`。
 *
 * @param {import("estree").Node} node 引数
 * @returns {string | undefined} 字面
 */
function literalText(node) {
  if (node.type === "Literal") {
    if ("regex" in node && node.regex !== undefined && node.regex !== null) return node.regex.pattern;
    if (typeof node.value === "string") return node.value;
    return undefined;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  return undefined;
}

/**
 * 正規表現の受け手の字面。リテラルのほか、`new RegExp(字面)` / `RegExp(字面)` の第 1 引数(式のあるテンプレートは読まない)。
 *
 * @param {import("estree").Node} node 受け手
 * @returns {import("estree").Node | undefined} 字面の節(無ければ undefined)
 */
function receiverLiteral(node) {
  if ((node.type === "NewExpression" || node.type === "CallExpression") && node.callee.type === "Identifier" && node.callee.name === "RegExp") {
    const first = node.arguments[0];
    return first === undefined || first.type === "SpreadElement" ? undefined : first;
  }
  return node;
}

/**
 * 字面が頭だけか。
 *
 * @param {import("estree").Node | undefined} node 引数
 * @returns {boolean} 頭だけなら true
 */
function prefixOnly(node) {
  if (node === undefined) return false;
  const text = literalText(node);
  return text !== undefined && PREFIX_ONLY.test(text);
}

/**
 * 呼び出しの的のメソッド名(`a.b.toThrow` の `toThrow`)。計算した鍵・識別子でなければ undefined。
 *
 * @param {import("estree").Node} callee 的
 * @returns {string | undefined} 名前
 */
function methodName(callee) {
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return undefined;
  return callee.property.name;
}

/**
 * オブジェクトの字面の中(入れ子も)の、`message` の欄の頭だけの字面。
 *
 * @param {import("estree").Node} node 引数
 * @returns {import("estree").Node[]} 頭だけの値
 */
function prefixOnlyMessages(node) {
  if (node.type !== "ObjectExpression") return [];
  return node.properties.flatMap((property) => {
    if (property.type !== "Property") return [];
    const key = property.computed ? undefined : property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? property.key.value : undefined;
    if (key === "message" && prefixOnly(property.value)) return [property.value];
    return prefixOnlyMessages(property.value);
  });
}

/**
 * `toHaveProperty` の第 1 引数の欄の道(`'message'` / `['message']`)。読めなければ undefined。
 *
 * @param {import("estree").Node} node 第 1 引数
 * @returns {string | undefined} 道
 */
function propertyPath(node) {
  if (node.type === "ArrayExpression") return node.elements.length === 1 && node.elements[0] !== null && node.elements[0].type !== "SpreadElement" ? literalText(node.elements[0]) : undefined;
  return literalText(node);
}

/**
 * 識別子の束縛(内側の scope から外へ探す)。`unbound` は束縛が無い(大域)、`import` は import の束縛、`local` はそれ以外の宣言。
 *
 * @param {import("eslint").SourceCode} source ソース
 * @param {import("estree").Identifier} node 識別子
 * @returns {{ kind: "unbound" } | { kind: "local" } | { kind: "import", module: string, imported: string }} 束縛
 */
function bindingOf(source, node) {
  for (let scope = source.getScope(node); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable === undefined) continue;
    const def = variable.defs[0];
    if (def === undefined) return { kind: "unbound" };
    if (def.type !== "ImportBinding") return { kind: "local" };
    const spec = def.node;
    const imported = spec.type === "ImportSpecifier" ? (spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value)) : spec.type === "ImportNamespaceSpecifier" ? "*" : "default";
    return { kind: "import", module: String(def.parent.source.value), imported };
  }
  return { kind: "unbound" };
}

/**
 * 節が `node:assert` の口の名前空間か(`assert` / 別名の既定・名前空間・`strict` の import / その `.strict` / `t.assert`)。
 *
 * @param {import("eslint").SourceCode} source ソース
 * @param {import("estree").Node} node 節
 * @returns {boolean} 名前空間なら true
 */
function assertNamespace(source, node) {
  if (node.type === "MemberExpression") {
    if (node.computed || node.property.type !== "Identifier" || !NESTED_NAMESPACE.has(node.property.name)) return false;
    // `t.assert`(node:test の文脈)は受け手を問わない。`x.strict` は受け手が口の名前空間のときだけ。
    return node.property.name === "assert" || assertNamespace(source, node.object);
  }
  if (node.type !== "Identifier") return false;
  const binding = bindingOf(source, node);
  if (binding.kind !== "import") return binding.kind === "unbound" && node.name === "assert";
  const named = ASSERT_MODULES.get(binding.module);
  if (named === undefined) return false;
  return binding.imported === "*" || binding.imported === "default" ? binding.module !== "vitest" : named.has(binding.imported);
}

/**
 * 呼び出しの的が口の照合の関数なら、その名前(`assert.match` / 名前つきの import の `match`)。それ以外は undefined。
 *
 * @param {import("eslint").SourceCode} source ソース
 * @param {import("estree").Node} callee 的
 * @returns {string | undefined} 照合の名前
 */
function assertCallName(source, callee) {
  if (callee.type === "MemberExpression") return assertNamespace(source, callee.object) ? methodName(callee) : undefined;
  if (callee.type !== "Identifier") return undefined;
  const binding = bindingOf(source, callee);
  if (binding.kind === "unbound") return callee.name === "assert" ? "ok" : undefined;
  if (binding.kind !== "import" || !ASSERT_MODULES.has(binding.module) || binding.module === "vitest") return undefined;
  return binding.imported === "default" ? "ok" : binding.imported;
}

/**
 * 節が照合の値の中にあり、そこまで関数をまたがないか(`expect` / `expect.soft` の呼び出しの引数と、`node:assert` の口への呼び出しの引数)。
 *
 * @param {import("eslint").SourceCode} source ソース
 * @param {import("estree").Node} node 節
 * @returns {boolean} 照合の値の中なら true
 */
function insideExpect(source, node) {
  for (const ancestor of [...source.getAncestors(node)].reverse()) {
    if (ancestor.type === "ArrowFunctionExpression" || ancestor.type === "FunctionExpression" || ancestor.type === "FunctionDeclaration") return false;
    if (ancestor.type !== "CallExpression") continue;
    const callee = ancestor.callee;
    if (callee.type === "Identifier" && callee.name === "expect") return true;
    if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "expect" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "soft") return true;
    if (assertCallName(source, callee) !== undefined) return true;
  }
  return false;
}

/**
 * `new Error('…')`(名前が `Error` で終わる構築子)の第 1 引数。それ以外は undefined。
 *
 * @param {import("estree").Node} node 引数
 * @returns {import("estree").Node | undefined} 第 1 引数
 */
function errorMessageOf(node) {
  if (node.type !== "NewExpression" || node.callee.type !== "Identifier" || !/Error$/.test(node.callee.name)) return undefined;
  const first = node.arguments[0];
  return first === undefined || first.type === "SpreadElement" ? undefined : first;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noFailurePrefixAssert = {
  meta: {
    type: "problem",
    docs: { description: "テストで失敗を「X に失敗しました」の頭の字面だけで見分けない(欄 where / sqlstate で見分ける)" },
    schema: [],
    messages: {
      prefixOnly:
        "失敗を「…に失敗しました」の頭の字面だけで見分けない(どの失敗でも緑になり、字面の形を直しただけで赤になる。fix19 の統合の赤 12 件)。`DbInfrastructureError` なら `toMatchObject({ name: 'DbInfrastructureError', where, sqlstate })` で、診断の `Error` なら理由の部分の字面で合わせる。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // `assert.<名前>(実際の値, 字面)`: 字面は第 2 引数(`node:assert`)。口は import の束縛から決める(名前つきの `match(…)` も)。
        const asserted = assertCallName(context.sourceCode, node.callee);
        if (asserted !== undefined && CALL_SHAPES.assertNamespace.has(asserted)) {
          const expected = node.arguments[1];
          if (expected !== undefined && expected.type !== "SpreadElement" && prefixOnly(expected)) {
            context.report({ node: expected, messageId: "prefixOnly" });
            return;
          }
        }
        const name = methodName(node.callee);
        if (name === undefined) return;
        // 正規表現の `.test(…)` / `.exec(…)` は受け手が字面(`/…に失敗しました$/.test(e.message)`・`new RegExp('…').exec(…)`)。
        if (CALL_SHAPES.receiver.has(name) && node.callee.type === "MemberExpression") {
          const literal = receiverLiteral(node.callee.object);
          if (literal !== undefined && prefixOnly(literal) && insideExpect(context.sourceCode, node)) {
            context.report({ node: literal, messageId: "prefixOnly" });
            return;
          }
        }
        const first = node.arguments[0];
        if (first === undefined || first.type === "SpreadElement") return;
        if ((ASSERTERS.has(name) || ASYMMETRIC.has(name) || (STRING_MATCHERS.has(name) && insideExpect(context.sourceCode, node))) && prefixOnly(first)) {
          context.report({ node: first, messageId: "prefixOnly" });
          return;
        }
        const message = ERROR_ASSERTERS.has(name) ? errorMessageOf(first) : undefined;
        if (message !== undefined && prefixOnly(message)) {
          context.report({ node: message, messageId: "prefixOnly" });
          return;
        }
        if (OBJECT_ASSERTERS.has(name)) for (const value of prefixOnlyMessages(first)) context.report({ node: value, messageId: "prefixOnly" });
        const second = node.arguments[1];
        if (name === PROPERTY_ASSERTER && second !== undefined && second.type !== "SpreadElement" && propertyPath(first) === "message" && prefixOnly(second)) {
          context.report({ node: second, messageId: "prefixOnly" });
        }
      },
    };
  },
};
