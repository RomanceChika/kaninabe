/**
 * `layer/require-safe-redirect` が見る**生の転送の口の表と、口の使い方の分類**(規則の本体は `require-safe-redirect.mjs`)。
 *
 * ここは純粋な判定だけを持ち、報告はしない。どの口も「安全な形の式なら通す」ではなく**使った時点で赤**にする
 * (点検 9 回目の方針: 危ない書き方を 1 つずつ拒否するのでなく、安全な部品の許可表で閉じる)。例外は読むだけの使い方
 * (`location.origin` の読み取り・`location.reload()`・`new Response(…)`・`instanceof`)で、それ以外の使い方
 * (別名に入れる・引数に渡す・計算した鍵で引く)は辿れないので fail-closed で赤にする。
 */

/** 転送の関数・ルーターを export する枠のモジュール(`.js` の綴りも同じ扱い)。 */
export const NAVIGATION_MODULE = "next/navigation";

/** `next/navigation` のうち、製品のコードが引いてはならない名前(転送の関数とルーターのフック)。 */
export const BANNED_NAVIGATION_NAMES = new Set(["redirect", "permanentRedirect", "useRouter"]);

/** `NextResponse`(`.redirect` を持つ応答の型)を export する枠のモジュール。 */
export const SERVER_MODULE = "next/server";

/**
 * 値の import を丸ごと禁じるモジュール(ルーターの全部を export する旧来の口と、枠の内部の深いパス)。
 * 内部のパス(`next/dist/…`)は `redirect` / `useRouter` の実体を別の綴りで引けるので、全部止める。
 *
 * @param {string} source - 正規化した指定子
 * @returns {boolean} 禁じるなら true
 */
export function isBannedModule(source) {
  return source === "next/router" || source === "next/compat/router" || source.startsWith("next/dist/");
}

/**
 * 指定子を正規化する(`next/navigation.js` → `next/navigation`)。
 *
 * @param {unknown} value - import の指定子
 * @returns {string | null} 正規化した綴り(字句でなければ null)
 */
export function moduleOf(value) {
  if (typeof value !== "string") return null;
  return value.replace(/\/index\.js$/u, "").replace(/\.js$/u, "");
}

/** ウィンドウを指すグローバル(とその同義のプロパティ)。`window.top.location` のように連ねてもよい。 */
export const WINDOW_HOSTS = new Set(["window", "self", "globalThis", "top", "parent", "frames", "opener"]);

/** 見出しの鍵のうち転送になるもの(小文字で比べる)。`Refresh: 0; url=…` も転送である。 */
const REDIRECT_HEADER = /^(?:location|refresh|x-middleware-rewrite)$/iu;

/** `location` の口のうち、呼ぶと遷移するもの。 */
const LOCATION_NAVIGATORS = new Set(["assign", "replace"]);

/**
 * メンバー参照の静的な名前(計算した鍵は字句だけ)。
 *
 * @param {import("estree").MemberExpression} node - メンバー参照
 * @returns {string | null} 名前(辿れなければ null)
 */
export function propertyName(node) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value;
  if (node.computed && node.property.type === "TemplateLiteral" && node.property.expressions.length === 0) return node.property.quasis[0]?.value.cooked ?? null;
  return null;
}

/**
 * 字句の文字列の値(文字列リテラル・式を持たないテンプレート)。
 *
 * @param {import("estree").Node | null | undefined} node - 式
 * @returns {string | null} 値(字句でなければ null)
 */
export function stringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

/**
 * 見出しの鍵の名前が転送になるか(大文字小文字を問わない)。
 *
 * @param {string | null} name - 鍵の名前
 * @returns {boolean} 転送の見出しなら true
 */
export function isRedirectHeader(name) {
  return name !== null && REDIRECT_HEADER.test(name);
}

/**
 * オブジェクトの鍵の名前(識別子・字句。計算した鍵は字句だけ)。
 *
 * @param {import("estree").Property} node - プロパティ
 * @returns {string | null} 名前
 */
export function keyName(node) {
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  return stringValue(node.key);
}

/**
 * 値の位置でない(型の位置・型の問い合わせの)参照か。
 *
 * @param {import("estree").Node} node - 参照の識別子
 * @returns {boolean} 型の位置なら true
 */
export function inTypePosition(node) {
  const parent = node.parent;
  return parent !== undefined && /^TS(?!AsExpression|NonNullExpression|SatisfiesExpression|TypeAssertion|InstantiationExpression)/u.test(parent.type);
}

/**
 * 参照が、比べるだけの使い方(`typeof x`・`x === …`・`'k' in x`・`a instanceof x`)か。
 *
 * @param {import("estree").Node} node - 参照
 * @returns {boolean} 比べるだけなら true
 */
function onlyCompared(node) {
  const parent = node.parent;
  if (parent?.type === "UnaryExpression" && parent.operator === "typeof") return true;
  return parent?.type === "BinaryExpression";
}

/**
 * 書き込みの的(代入の左辺・`++` / `--`)か。
 *
 * @param {import("estree").Node} node - 式
 * @returns {boolean} 書き込みなら true
 */
function isWriteTarget(node) {
  const parent = node.parent;
  return (parent?.type === "AssignmentExpression" && parent.left === node) || (parent?.type === "UpdateExpression" && parent.argument === node);
}

/**
 * `location` の物(グローバルの `location`・`window.location`・`document.location` など)の使い方を分類する。
 *
 * 読むだけ(`location.origin` / `location.hash` の読み取り・`location.reload()`・比べる)は通す。代入(`location = …`・
 * `location.href = …`・どのプロパティでも)と `assign` / `replace`(呼び出しでも別名でも)、計算した鍵、別名に入れる・渡す形は赤。
 *
 * @param {import("estree").Node} node - `location` の物を指す式
 * @returns {string | null} 赤にする理由(通すなら null)
 */
export function classifyLocation(node) {
  if (isWriteTarget(node)) return "location への代入";
  const parent = node.parent;
  if (parent?.type === "MemberExpression" && parent.object === node) {
    const name = propertyName(parent);
    if (name === null) return "location の計算した鍵";
    if (isWriteTarget(parent)) return `location.${name} への代入`;
    if (LOCATION_NAVIGATORS.has(name)) return `location.${name}`;
    return null;
  }
  return onlyCompared(node) ? null : "location の別名・受け渡し";
}

/** 応答の型の、通す静的なメンバー(行き先を持たない)。 */
const RESPONSE_STATIC_MEMBERS = new Set(["json", "next", "error"]);

/**
 * `.redirect` を持つ応答の型(`NextResponse`・グローバルの `Response`)の使い方を分類する。
 *
 * 通すのは閉じた表 {@link RESPONSE_STATIC_MEMBERS} の静的なメンバー・`new X(…)`・`instanceof X`・型の位置だけで、
 * `X.redirect`・`X.rewrite`(点検 13 回目 B13-5)・表の外のメンバー・計算した鍵・別名に入れる・渡す・再 export する形は赤。
 *
 * @param {import("estree").Node} node - 型を指す式
 * @param {string} label - 報告に使う名前
 * @returns {string | null} 赤にする理由(通すなら null)
 */
export function classifyResponseClass(node, label) {
  if (inTypePosition(node)) return null;
  const parent = node.parent;
  if (parent?.type === "MemberExpression" && parent.object === node) {
    const name = propertyName(parent);
    if (name === null) return `${label} の計算した鍵`;
    return RESPONSE_STATIC_MEMBERS.has(name) ? null : `${label}.${name}`;
  }
  if (parent?.type === "NewExpression" && parent.callee === node) return null;
  if (parent?.type === "BinaryExpression" && parent.operator === "instanceof" && parent.right === node) return null;
  return `${label} の別名・受け渡し`;
}

/**
 * ウィンドウ(と `document`)から連ねた式の先(`window.top.location` の `window.top`)を分類する。
 *
 * @param {import("estree").Node} host - ウィンドウか `document` を指す式
 * @param {boolean} isDocument - `document` を指すか
 * @returns {{ kind: "location" | "response" | "document" | "window" | "report" | "ok", node: import("estree").Node, reason?: string }} 分類(`document` / `window` は連なりの続き。`document.defaultView` は `window`)
 */
export function classifyHost(host, isDocument) {
  const parent = host.parent;
  if (parent?.type !== "MemberExpression" || parent.object !== host) {
    if (inTypePosition(host) || onlyCompared(host)) return { kind: "ok", node: host };
    return { kind: "report", node: host, reason: "ウィンドウの別名・受け渡し(遷移の口を辿れない)" };
  }
  const name = propertyName(parent);
  if (name === null) return { kind: "report", node: parent, reason: "ウィンドウの計算した鍵" };
  if (name === "location") return { kind: "location", node: parent };
  // `document.defaultView` はウィンドウそのもの(点検 10 回目 B10-6)。そこから先はウィンドウの連なりとして辿る。
  if (isDocument) return name === "defaultView" ? { kind: "window", node: parent } : { kind: "ok", node: parent };
  if (name === "open") return { kind: "report", node: parent, reason: "window.open" };
  if (name === "navigation") return { kind: "report", node: parent, reason: "window.navigation(Navigation API の navigate)" };
  if (name === "Response") return { kind: "response", node: parent };
  if (name === "document") return { kind: "document", node: parent };
  if (WINDOW_HOSTS.has(name)) return { kind: "window", node: parent };
  return { kind: "ok", node: parent };
}

/**
 * 式が関数の値か(矢印関数・関数式・同じスコープで辿れる関数の宣言や関数で初期化した `const`)。見出しの値は文字列なので、
 * 関数の値を持つ `refresh` / `location` の鍵(`{ refresh: () => router.refresh() }`)は見出しではない。
 *
 * @param {import("estree").Node | null | undefined} node - 値の式
 * @param {(name: string) => { kind: "function" | "init", init: import("estree").Node | null } | null} declarationOf - 識別子の宣言を返す
 * @returns {boolean} 関数の値なら true
 */
export function isFunctionValue(node, declarationOf) {
  if (node === null || node === undefined) return false;
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true;
  if (node.type !== "Identifier") return false;
  const declared = declarationOf(node.name);
  if (declared === null) return false;
  return declared.kind === "function" || declared.init?.type === "ArrowFunctionExpression" || declared.init?.type === "FunctionExpression";
}

/**
 * プロパティが転送の見出しの鍵か(**位置を問わない**。点検 10 回目 B10-1)。鍵の名前が大文字小文字を問わず `location` / `refresh` で、
 * 値が関数でない(メソッド・getter / setter・関数の値でない)もの。
 *
 * @param {import("estree").Property} node - オブジェクトのリテラルのプロパティ
 * @param {(name: string) => { kind: "function" | "init", init: import("estree").Node | null } | null} declarationOf - 識別子の宣言を返す
 * @returns {boolean} 見出しの鍵なら true
 */
export function isRedirectHeaderProperty(node, declarationOf) {
  if (!isRedirectHeader(keyName(node))) return false;
  if (node.method || node.kind !== "init") return false;
  return !isFunctionValue(node.value, declarationOf);
}
