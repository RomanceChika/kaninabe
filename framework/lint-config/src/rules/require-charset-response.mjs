/**
 * 本文のある応答は **`jsonResponse` / `textResponse`(`@kaninabe/runtime/http/response`)で作らせる**(ASVS V4.1.1。
 * 本文のある応答に、中身に合う `Content-Type` と文字コード)。
 *
 * `Response.json(…)` は `Content-Type: application/json` を付けるが charset を付けない。`new Response(本文, …)` は
 * 文字列の本文なら `text/plain;charset=UTF-8` を既定で付けるが、ストリーム・`Blob`・`Uint8Array` では何も付かない。
 * 部品は `Content-Type` を**常に**決める。この規則は、部品を通らない本文つきの応答を止める。
 *
 * **違反**(`Response` は「グローバルの `Response`」か「`next/server` から import した `NextResponse`」。**束縛で見る** ——
 * スコープ解析で本物に解決できたときだけ。自前の `class Response`・引数・別モジュールの同名は対象外。`const R = Response` や
 * `globalThis.Response`・TS のラッパも辿る):
 *   - `Response.json(…)` / `NextResponse.json(…)`(呼ばずに値として取り出す形・`Response['json']`・計算した鍵・`const { json } = Response` も)
 *   - `new Response(本文, init)` / `new NextResponse(本文, init)` のうち、本文が `null` / `undefined` / 省略**でない**もので、
 *     `init.headers` が**オブジェクトのリテラルで `Content-Type` の鍵を持ち、値が `application/json` か `text/plain` の `charset=` つきの文字列リテラル**
 *     である形でないもの(つまり `{ headers: { 'Content-Type': 'text/plain; charset=utf-8' } }` のように**その場で字面に書いた**ときだけ通る。
 *     `Headers` の組み立て・変数・展開は静的に確かめられないので違反 = 部品を使う。`text/html` の字面は通さない。実行時の主の守りは出口の関所
 *     `guardRoute` の `Content-Type` の閉じた表で、この規則は早めの知らせである。点検 11 回目 B11-3)
 *
 * **通る**: 本文を持たない応答(`new Response(null, …)` / 204 / 転送 `NextResponse.redirect` / `NextResponse.next`)。
 * 免除の口は作らない(`no-eslint-disable-comment` が止める)。部品自身の置き場だけを設定側で範囲から外す。
 */

import { holderKind, findVariable, memberName, unwrap } from "./no-external-network.mjs";

/** `Response` を指す import: モジュール → export 名。 */
const NEXT_RESPONSE = { module: "next/server", imported: "NextResponse" };

/** 本文が無いことを示す `null` / `undefined` のノードか。 */
function isNoBody(node) {
  if (node === undefined) return true;
  const inner = unwrap(node);
  return (inner.type === "Literal" && inner.value === null && inner.raw === "null") || (inner.type === "Identifier" && inner.name === "undefined");
}

/**
 * ノードが `Response`(グローバル)か `NextResponse`(`next/server` の import)を指すか。
 *
 * @param {import("estree").Node} rawNode - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @returns {boolean} 指すなら true
 */
function isResponseClass(rawNode, scope, depth = 0) {
  if (depth > 4) return false;
  const node = unwrap(rawNode);
  if (node.type === "MemberExpression") {
    return memberName(node) === "Response" && holderKind(node.object, scope) === "global";
  }
  if (node.type !== "Identifier") return false;
  const variable = findVariable(scope, node.name);
  if (variable === null || variable.defs.length === 0) return node.name === "Response";
  if (variable.defs.length !== 1) return false;
  const definition = variable.defs[0];
  if (definition.type === "ImportBinding") {
    const specifier = definition.node;
    if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type" || definition.parent?.importKind === "type") return false;
    const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
    return definition.parent?.source?.value === NEXT_RESPONSE.module && imported === NEXT_RESPONSE.imported;
  }
  if (definition.type !== "Variable" || definition.parent?.kind !== "const" || definition.node.id.type !== "Identifier" || !definition.node.init) {
    return false;
  }
  return isResponseClass(definition.node.init, variable.scope, depth + 1);
}

/** プロパティの鍵(小文字化)。静的に決まらない鍵(計算した鍵)は null。 */
function keyOf(property) {
  const key = memberName({ computed: property.computed || property.key.type === "Literal", property: property.key });
  return key === null ? null : key.toLowerCase();
}

/** 字面で許す `Content-Type`(`application/json` / `text/plain` の charset つきだけ)。 */
const CHARSET_LITERAL = /^\s*(?:application\/json|text\/plain)\s*;\s*charset=/i;

/** 値が許す型と charset を字面に書いた文字列リテラル(式を含まないテンプレートも)か。 */
function isCharsetLiteral(value) {
  if (value.type === "Literal") return typeof value.value === "string" && CHARSET_LITERAL.test(value.value);
  if (value.type === "TemplateLiteral") return value.expressions.length === 0 && CHARSET_LITERAL.test(value.quasis[0]?.value.cooked ?? "");
  return false;
}

/** 展開・メソッド・getter・静的に決まらない鍵を含まない、通常のプロパティだけのオブジェクトか。 */
function isPlainObject(node) {
  return node.type === "ObjectExpression" && node.properties.every((property) => property.type === "Property" && property.kind === "init" && !property.method && keyOf(property) !== null);
}

/**
 * `new Response(本文, init)` の `init` が、`Content-Type` に charset を字面に書いたオブジェクトか。
 *
 * **最終の headers を保守的に決める**: init も headers も「展開・メソッド・計算した鍵を含まない単一のオブジェクトリテラル」で、
 * `headers` の鍵がちょうど 1 つ、その中の `Content-Type`(大文字小文字を区別しない)の鍵もちょうど 1 つで、値が charset 付きの字面のときだけ true。
 * 展開(外側・内側)・重複した鍵による上書き・`Headers` の組み立て・変数は、最終値を静的に確かめられないので false(= 違反)。
 *
 * @param {import("estree").Node | undefined} init - `new` の第 2 引数
 * @returns {boolean} 書いてあれば true
 */
function hasLiteralCharsetContentType(init) {
  if (init === undefined || !isPlainObject(init)) return false;
  const headers = init.properties.filter((property) => keyOf(property) === "headers");
  if (headers.length !== 1 || !isPlainObject(headers[0].value)) return false;
  const contentTypes = headers[0].value.properties.filter((property) => keyOf(property) === "content-type");
  return contentTypes.length === 1 && isCharsetLiteral(contentTypes[0].value);
}

/** @type {import("eslint").Rule.RuleModule} */
export const requireCharsetResponse = {
  meta: {
    type: "problem",
    docs: {
      description: "本文のある応答は jsonResponse / textResponse(@kaninabe/runtime/http/response)で作らせる(Response.json と charset の無い new Response を止める)",
    },
    schema: [],
    messages: {
      json: "`Response.json` / `NextResponse.json` は charset を付けない。JSON の応答は `jsonResponse`(`@kaninabe/runtime/http/response`)で作る(`application/json; charset=utf-8`。ASVS V4.1.1)。",
      body: "本文のある `new Response(…)` は `Content-Type` の charset を保証できない。`jsonResponse` / `textResponse`(`@kaninabe/runtime/http/response`)で作る(字面で通るのは `application/json` / `text/plain` の charset つきだけ。ダウンロードは `attachmentResponse`。本文を持たない応答は `new Response(null, …)` でよい。ASVS V4.1.1)。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      MemberExpression(node) {
        const name = memberName(node);
        if (name !== null && name !== "json") return;
        if (!isResponseClass(node.object, sourceCode.getScope(node))) return;
        context.report({ node, messageId: "json" });
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        if (!isResponseClass(node.init, sourceCode.getScope(node))) return;
        const takes = node.id.properties.some((property) => {
          if (property.type === "RestElement") return true;
          const name = memberName({ computed: property.computed || property.key.type === "Literal", property: property.key });
          return name === null || name === "json";
        });
        if (takes) context.report({ node: node.id, messageId: "json" });
      },
      NewExpression(node) {
        if (!isResponseClass(node.callee, sourceCode.getScope(node))) return;
        if (isNoBody(node.arguments[0])) return;
        if (hasLiteralCharsetContentType(node.arguments[1])) return;
        context.report({ node, messageId: "body" });
      },
    };
  },
};
