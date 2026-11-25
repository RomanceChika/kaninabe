/**
 * 手書きのコードで zod の**文字列のスキーマ**を作らせない(点検 19 回目 O19-1・20 回目 C20-2。以前は `text-input-coverage.test.ts` の正規表現 `\bz\.string\s*\(`)。
 *
 * 利用者の文字列の入口は、生成物の `textInput()`(制御文字・長さ・正規化を通す)か、その共通部品(`@kaninabe/runtime/text-input`)だけである。
 * ここは**名前の解決**で見る: 呼び出しの的を、`zod` から import した名前(名前空間・既定・名前つき・別名)を根にした「zod の中の道」
 * (`z.email` → `email`・`z.coerce.string` → `coerce.string`・`import { iso } from 'zod'; iso.date` → `iso.date`)に直し、道が
 * **文字列のスキーマを作る関数の閉じた表**(`ZOD_STRING_BUILDERS`)に載っていれば赤。`custom` は型引数に文字列の型を含めば赤(`z.custom<string>()`)。
 *
 * 表は zod の型定義(`v4/classic` の `schemas.d.ts` / `iso.d.ts` / `coerce.d.ts`)の「戻り値が `_ZodString` の派生」の関数から作り直せる。
 * 作り直した表と突き合わせる試験(製品の規則のテスト)があり、zod の版を上げて文字列の
 * 関数が増えると赤になる(表に足す)。`templateLiteral` は `_ZodString` の派生でないが値が文字列なので、手で足した行(`EXTRA_STRING_BUILDERS`)。
 *
 * **zod の入口は `zod` だけ**: `zod/v4`・`zod/mini`・`zod/v4-mini` などの下位の入口の import は、それだけで赤(`subpath`)。下位の入口は
 * 別の名前の型(`ZodMiniString` など)と関数を持ち、上の表で閉じられない(点検 20 回目 C20-2: `zod/v4` の `z.string()` と
 * `zod/mini` の `z.string()` を通していた)。念のため、下位の入口からの名前も同じ表で見る。
 *
 * 型で見る形(呼び出しの戻り値が zod の文字列系の型かを typescript-eslint の型情報で見る)は採らなかった: 規則の単体テストが
 * メモリ上の Linter で回っていて、型情報を持たせるにはディスク上の tsconfig の木が要り、試験の形を作り直すことになる。閉じた表と、
 * zod の型定義から作り直す試験で、版の上げで増える関数を拾う。
 *
 * 下位の入口の名指しは、import 文・再輸出・`import =`・動的な import と、**どの呼び出しの第 1 引数**の字面にも掛ける(`require`・`createRequire(…)(…)`・
 * `vi.importActual` / `vi.mock`。点検 22 回目 C22-5。パッケージの記述 `zod/package.json` の名指しと、文字列の比べのメソッドは外す)。
 *
 * 見ない下限: 計算した鍵(`z['string']()`)・`zod` を再輸出した別のモジュール経由・分割代入で取り出した関数(`const { string } = z`)・
 * `z.core` の低い層の関数(`z.core._string(...)`)・`z.json()`(値の一部に文字列を含みうる)。
 *
 * **入力の境界の閉世界**(オプション `closedObjects`。点検 25 回目 O25-2 / B の X3): 境界(保存点・単発の操作・Server Action・読み取り・RPC の
 * 引数を組むコード。どこが境界かは設定の `files`)では、余分な鍵を黙って剥がす開いた object(`OPEN_OBJECT_BUILDERS`)を赤にし、`z.strictObject`
 * だけを通す。未知の欄を許す所は理由つきの閉じた表 `OPEN_OBJECT_ACCEPTED` だけ。生成物の境界は `strings: false`(文字列の表を外す)で掛ける。
 * 見ない下限は借りた開いた object の `.pick` / `.omit` / `.extend`(型が要る)で、実行時の見張り TC-GUAR-FORM-004 が全部の入力の catchall を見る。
 */

/**
 * 文字列のスキーマを作る関数(zod の中の道 → 由来)。根(`z.<名前>`)・`coerce.<名前>`・`iso.<名前>`。
 * 由来が `d.ts` の行は zod の型定義から作り直せる(突合は試験)。
 */
export const ZOD_STRING_BUILDERS = Object.freeze({
  root: Object.freeze([
    "base64",
    "base64url",
    "cidrv4",
    "cidrv6",
    "creditCard",
    "cuid",
    "cuid2",
    "currencyCode",
    "e164",
    "email",
    "emoji",
    "guid",
    "hash",
    "hex",
    "hostname",
    "httpUrl",
    "iban",
    "ipv4",
    "ipv6",
    "jwt",
    "ksuid",
    "mac",
    "nanoid",
    "string",
    "stringFormat",
    "ulid",
    "url",
    "uuid",
    "uuidv4",
    "uuidv6",
    "uuidv7",
    "xid",
  ]),
  coerce: Object.freeze(["string"]),
  iso: Object.freeze(["date", "datetime", "duration", "time"]),
});

/** `_ZodString` の派生でないが、値が文字列のスキーマを作る関数(根)。手で足した行。 */
export const EXTRA_STRING_BUILDERS = Object.freeze(["templateLiteral"]);

/**
 * 入力の境界で使わない**開いた object** を作る呼び出し(点検 25 回目 O25-2)。根(`z.<名前>`)と、どの値の上のメソッドでも赤にする名前。
 * 閉じた object は `z.strictObject` だけ。
 */
export const OPEN_OBJECT_BUILDERS = Object.freeze({
  root: Object.freeze(["object", "looseObject"]),
  methods: Object.freeze(["passthrough", "loose", "strip"]),
});

/**
 * 入力の境界で開いた object を許す所の閉じた表(理由つき)。`file` はファイルの道の末尾に当てる正規表現、`name` は開いた object を
 * 代入する変数の名前に当てる正規表現。規則のテストが、行が今も使われていること(該当の名前がその置き場に実在すること)を見る。
 */
export const OPEN_OBJECT_ACCEPTED = Object.freeze([
  Object.freeze({
    file: /(?:^|\/)src\/domain\/generated\/[a-z_]+\.schema\.ts$/u,
    name: /^[a-z][A-Za-z]*InputSchema$/u,
    reason:
      "エンティティの作成の欄の部品(`{entity}InputSchema`。code-zod.ts)。フォームの部品が欄を借りる口で、境界の入力ではない —— 単発の操作の入力(operation-inputs)と保存点の入力(usecase-inputs)は借りた欄の shape を z.strictObject で包み直す",
  }),
]);

/** 第 1 引数にモジュールの名前の字面を取っても取り込まないメソッド(文字列の比べ。点検 22 回目 C22-5)。 */
const NOT_LOADING = new Set(["startsWith", "endsWith", "includes", "indexOf", "lastIndexOf", "localeCompare"]);

/** 呼び出しの第 1 引数でも下位の入口に数えない名指し(パッケージの記述。取り込む入口ではない。点検 22 回目 C22-5)。 */
const PACKAGE_MANIFEST = "zod/package.json";

/** 名前空間(`coerce` / `iso`)。 */
const NAMESPACES = new Set(["coerce", "iso"]);

/**
 * モジュールの名指し(文字列のリテラルか、式の無いテンプレート)が zod の下位の入口なら `subpath` を出す。
 *
 * @param {import("eslint").Rule.RuleContext} context 規則の文脈
 * @param {any} node 名指しの節
 * @returns {void}
 */
function reportSubpath(context, node) {
  const value = node?.type === "Literal" ? node.value : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : undefined;
  if (isZodSource(value) && value !== "zod") context.report({ node, messageId: "subpath" });
}

/**
 * zod の入口の名指しか(`zod` と `zod/…`)。
 *
 * @param {unknown} source モジュールの名指し
 * @returns {boolean} zod の入口なら true
 */
function isZodSource(source) {
  return typeof source === "string" && (source === "zod" || source.startsWith("zod/"));
}

/**
 * 名前が zod からの import に解決できるなら、その名前が指す「zod の中の道」(名前空間・既定・`z` は空の道、ほかの名前つきは `[名前]`)。
 *
 * @param {import("eslint").Scope.Scope} scope 呼び出しのスコープ
 * @param {string} name 名前
 * @returns {readonly string[] | null} 道(解決できなければ null)
 */
function zodPathOf(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable === undefined) continue;
    const definition = variable.defs[0];
    if (definition === undefined || definition.type !== "ImportBinding") return null;
    const declaration = definition.parent;
    if (declaration.type !== "ImportDeclaration" || !isZodSource(declaration.source.value)) return null;
    const specifier = definition.node;
    if (specifier.type !== "ImportSpecifier") return [];
    const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value);
    return imported === "z" || imported === "default" ? [] : [imported];
  }
  return null;
}

/**
 * 呼び出しの的を「根の名前 + 名前の並び」に直す(`z.coerce.string` → `z` と `['coerce', 'string']`)。計算した鍵があれば null。
 *
 * @param {import("estree").Node} callee 呼び出しの的
 * @returns {{ readonly root: string, readonly members: readonly string[] } | null} 根と並び
 */
function memberChain(callee) {
  const members = [];
  let current = callee;
  while (current.type === "MemberExpression") {
    if (current.computed || current.property.type !== "Identifier") return null;
    members.unshift(current.property.name);
    current = current.object;
  }
  return current.type === "Identifier" ? { root: current.name, members } : null;
}

/**
 * zod の中の道が文字列のスキーマを作る関数か。
 *
 * @param {readonly string[]} path 道
 * @returns {boolean} 作るなら true
 */
function buildsString(path) {
  if (path.length === 1) return ZOD_STRING_BUILDERS.root.includes(path[0]) || EXTRA_STRING_BUILDERS.includes(path[0]);
  if (path.length === 2 && NAMESPACES.has(path[0])) return ZOD_STRING_BUILDERS[path[0]].includes(path[1]);
  return false;
}

/**
 * 型の木のどこかに文字列の型(`string`・文字列のリテラル型・テンプレートリテラル型)があるか。
 *
 * @param {unknown} node 型の節
 * @returns {boolean} あれば true
 */
function mentionsStringType(node) {
  if (node === null || typeof node !== "object") return false;
  const typed = /** @type {{ type?: unknown }} */ (node);
  if (typed.type === "TSStringKeyword" || typed.type === "TSTemplateLiteralType") return true;
  if (typed.type === "TSLiteralType") {
    const literal = /** @type {{ literal?: { type?: string, value?: unknown } }} */ (node).literal;
    if (literal?.type === "Literal" && typeof literal.value === "string") return true;
    if (literal?.type === "TemplateLiteral") return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value) ? value.some((item) => mentionsStringType(item)) : mentionsStringType(value)) return true;
  }
  return false;
}

/** 呼び出しを代入する変数の名前(`const x = …` の `x`。鎖の途中なら外側の宣言まで上る)。無ければ null。 @param {any} node 呼び出し @returns {string | null} 名前 */
function assignedName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "VariableDeclarator") return current.id.type === "Identifier" ? current.id.name : null;
    if (current.type === "Program" || current.type.startsWith("Function") || current.type === "ArrowFunctionExpression") return null;
  }
  return null;
}

/** 開いた object を許す表の行に当たるか。 @param {string} filename ファイルの道 @param {any} node 呼び出し @returns {boolean} 当たるなら true */
function acceptedOpen(filename, node) {
  const name = assignedName(node);
  const file = filename.replaceAll("\\", "/");
  return name !== null && OPEN_OBJECT_ACCEPTED.some((row) => row.file.test(file) && row.name.test(name));
}

/** @type {import("eslint").Rule.RuleModule} */
export const noRawZodString = {
  meta: {
    type: "problem",
    docs: { description: "手書きのコードで zod の文字列のスキーマ(string / coerce.string / email / url / stringFormat / custom<string> …)を作らない。zod の入口は `zod` だけ" },
    schema: [
      {
        type: "object",
        properties: { strings: { type: "boolean" }, closedObjects: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      open:
        "入力の境界では余分な鍵を黙って剥がす開いた object(z.object / z.looseObject / .passthrough() / .loose() / .strip())を使わない。z.strictObject で閉じる(宣言に無い鍵は unrecognized_keys で断る。点検 25 回目 O25-2)。未知の欄を許す理由があるなら、規則の表 OPEN_OBJECT_ACCEPTED に理由つきで載せる。",
      raw: "zod の文字列のスキーマを手書きしない(制御文字・長さ・正規化を通らない利用者の文字列の入口になる。`z.url()` は NUL と BEL を通す)。入力は生成物の textInput() か、その共通部品(`@kaninabe/runtime/text-input`)で受ける(点検 19 回目 O19-1・20 回目 C20-2)。",
      subpath: "zod は `zod` の入口からだけ import する(`zod/v4`・`zod/mini` などの下位の入口は、別の名前の文字列の関数を持ち、文字列のスキーマの表で閉じられない。点検 20 回目 C20-2)。",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const options = /** @type {{ strings?: boolean, closedObjects?: boolean }} */ (context.options[0] ?? {});
    const strings = options.strings !== false;
    const closedObjects = options.closedObjects === true;
    return {
      // 下位の入口の禁止は、モジュールを名指す全部の口に掛ける(点検 21 回目 C21-2。以前は import 文だけで、
      // `export { z } from 'zod/v4'`・`export * from 'zod/mini'`・`import z = require('zod/v4')`・`import('zod/v4')` が通った)。
      ImportDeclaration(node) {
        reportSubpath(context, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) reportSubpath(context, node.source);
      },
      ExportAllDeclaration(node) {
        reportSubpath(context, node.source);
      },
      ImportExpression(node) {
        reportSubpath(context, node.source);
      },
      TSImportEqualsDeclaration(node) {
        const reference = /** @type {{ moduleReference?: { type?: string, expression?: unknown } }} */ (/** @type {unknown} */ (node)).moduleReference;
        if (reference?.type === "TSExternalModuleReference") reportSubpath(context, reference.expression);
      },
      CallExpression(node) {
        // モジュールを名指す呼び出しの第 1 引数(`require('zod/v4')`・`createRequire(…)('zod/v4')`・`vi.importActual('zod/v4')`・`vi.mock('zod/v4')` …)。
        // 呼び手の名前の表で閉じず、**どの呼び出しでも**第 1 引数がちょうど zod の下位の入口の字面なら赤にする(点検 22 回目 C22-5。
        // 取り込み手の綴りは増えるが、`'zod/v4'` をそのまま渡す呼び出しはモジュールの名指ししか無い)。文字列の比べのメソッド(閉じた表 NOT_LOADING)と
        // パッケージの記述の名指し(PACKAGE_MANIFEST。表の作り直しが型定義の置き場を探すのに使う)は外す。
        if (!(node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.property.type === "Identifier" && NOT_LOADING.has(node.callee.property.name))) {
          const target = node.arguments[0];
          if (target !== undefined && target.type !== "SpreadElement" && !(target.type === "Literal" && target.value === PACKAGE_MANIFEST)) reportSubpath(context, target);
        }
        // 入力の境界の開いた object のメソッド(どの値の上でも。`.passthrough()` などは zod の object にしか無い名前)。
        if (closedObjects && node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.property.type === "Identifier" && OPEN_OBJECT_BUILDERS.methods.includes(node.callee.property.name) && !acceptedOpen(context.filename, node)) {
          context.report({ node, messageId: "open" });
        }
        const chain = memberChain(node.callee);
        if (chain === null) return;
        const base = zodPathOf(source.getScope(node), chain.root);
        if (base === null) return;
        const path = [...base, ...chain.members];
        if (closedObjects && path.length === 1 && OPEN_OBJECT_BUILDERS.root.includes(path[0]) && !acceptedOpen(context.filename, node)) {
          context.report({ node, messageId: "open" });
        }
        if (!strings) return;
        const typeArguments = /** @type {{ typeArguments?: unknown, typeParameters?: unknown }} */ (node);
        if (buildsString(path) || (path.length === 1 && path[0] === "custom" && mentionsStringType(typeArguments.typeArguments ?? typeArguments.typeParameters))) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};
