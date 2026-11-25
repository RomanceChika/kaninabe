/**
 * **転送を作れるのは、仕組みの安全な転送の部品だけ**にする(ASVS V3.7.2。点検 8 回目 B8-2・9 回目 B9-1〜B9-6)。
 *
 * 「ログイン後に元の画面へ戻す `?next=`」のように利用者の値を転送先に渡すと、`/login?next=https://evil.example` が
 * 開いた転送(フィッシングの踏み台)になる。8 回目の直しは「転送の口に渡す式が静的に安全か」を見たが、口の表の外
 * (ブラウザの遷移・手で書いた `Location`)と、式の見分けの検査の漏れ(自前のフックの別名・名前空間・字句の頭の制御文字・
 * `screenPath` の値・`new URL(x, base)` の `base`)が残った(9 回目 B9-1〜B9-6)。そこで**許可表で閉じる**:
 * 生の転送の口は、渡す値に関係なく**使った時点で赤**にし、転送は次の安全な部品からだけ作る。部品はどれも行き先を
 * `safeReturnPath`(同じオリジンの相対パスだけ。`//`・`/\`・スキーム・制御文字・正規化で `//` に畳まれる綴りを拒む)に通す。
 *   - サーバー(Server Component・Server Action): `safeRedirect(行き先)` ← `@kaninabe/runtime/navigation`
 *   - Route Handler の応答: `safeRedirectResponse(行き先)` ← `@kaninabe/runtime/http/redirect`
 *   - クライアントの遷移: `useSafeNavigate()` の `push` / `replace` / `assign` / `refresh` ← `@kaninabe/runtime/navigation/client`
 *
 * 赤にする生の口(**名前でなく束縛で見る**。別名の import・名前空間の import・再 export・動的 import も同じ):
 *   - `next/navigation` の `redirect` / `permanentRedirect` / `useRouter`(import した時点で赤。名前空間なら参照で赤)
 *   - `next/router` / `next/compat/router` / `next/dist/…` の値の import の全部
 *   - `NextResponse.redirect`(`next/server`)・グローバルの `Response.redirect`(`globalThis.Response.redirect` も)。
 *     型の別名に入れる・引数に渡す・再 export する形も、辿れないので赤(`new X(…)`・`X.json(…)`・`instanceof`・型の位置は通す)
 *   - ブラウザの遷移: `location` / `window.location` / `document.location` への代入とそのプロパティへの代入・
 *     `location.assign` / `replace`・`window.open`・`window.navigation`・ウィンドウや `location` を別名に入れる形。
 *     `document.defaultView`・`el.ownerDocument` の連なりも同じ(Route Handler と違い、クライアントの遷移に実行時の関所は無く、この規則が主の守りである)
 *   - 見出しの `Location` / `Refresh`: オブジェクトの鍵(**位置を問わず**大文字小文字を問わない。値が関数の鍵は除く)・
 *     メンバーへの代入の左辺(`headers['Location'] = …`)・`[['Location', x]]` の組・`.set` / `.append` の字句の鍵(**相手を問わない**。
 *     点検 10 回目 B10-1)
 *   - `<meta http-equiv="refresh">`(JSX の属性と `createElement` の props。値が式なら辿れないので赤)
 *
 * 例外(許可表)は**安全な部品の実装ファイルだけ**で、{@link SAFE_REDIRECT_PARTS} が 1 か所に持つ(設定はこの表から
 * `ignores` を作る。表の行が実在することは規則のテストが見る)。製品の木には例外が無い。免除の口は作らない
 * (`no-eslint-disable-comment` が止める)。
 *
 * **この規則は早めの知らせであって、主の守りではない**(点検 10 回目 B10-1)。綴りを追う規則は兄弟の書き方を取りこぼすので、
 * Route Handler の応答の主の守りは実行時の出口の関所 `guardRoute`(`@kaninabe/runtime/http/route-guard`。全部の `route.ts` の口を
 * 包むことを J2 が見る)が持つ。Server Component / Server Action の転送は唯一の部品 `safeRedirect` の実行時の判定が持つ。
 *
 * 見ない下限(関所が実行時に止める): 見出しの鍵を式で渡す `headers.set(name, value)`(名前が字句か字句の `const` のときだけ見る。
 * 製品で式の鍵を使うのは生成した守りの表 `BROWSER_DEFENSE` の名前だけ)・見出しのオブジェクトをスプレッドで組む形・
 * `Reflect` / `eval` 経由(`layer/no-dynamic-code` が止める)。
 *
 * @oversize 1 本の規則が「転送の口の全部」を 1 つの訪問で閉じる(import の束縛の追跡・グローバルの参照・見出しの鍵・JSX)。
 *   口の表を規則ごとに割ると、同じ束縛を 2 つの規則が別々に辿り、片方の検査の漏れが開いた転送になる(9 回目 B9-6 の教訓)。
 * @split-review 口の使い方の分類(`location` / 応答の型 / ウィンドウの連なり / 見出しの位置)は純関数として `redirect-sinks.mjs` に
 *   割り出した。残る束縛の追跡(import・再 export・動的 import・名前空間)を別ファイルに割る案は、報告の重複を消す集合と
 *   スコープの解決を 2 か所で持つことになるので採らない。
 */

import { findVariable } from "./require-safe-link.mjs";
import {
  BANNED_NAVIGATION_NAMES,
  NAVIGATION_MODULE,
  SERVER_MODULE,
  WINDOW_HOSTS,
  classifyHost,
  classifyLocation,
  classifyResponseClass,
  inTypePosition,
  isBannedModule,
  isFunctionValue,
  isRedirectHeader,
  isRedirectHeaderProperty,
  keyName,
  moduleOf,
  propertyName,
  stringValue,
} from "./redirect-sinks.mjs";

/**
 * 安全な転送の部品の実装ファイル(この規則の唯一の例外)。行は**パッケージ(リポジトリルートからの根)とファイル(その根からの相対)の組**で、
 * 仕組みの設定はそのパッケージの行だけを外す(`framework-source.mjs` の `safeRedirectExemptions`。点検 10 回目 B10-6)。
 * 足すのは仕組みの部品だけで、製品の木のファイルは載せない。行のファイルが公開の入口から出してよい転送を作る関数は
 * `safeRedirect` / `safeRedirectResponse` / `safeNavigator` / `useSafeNavigate` だけ(規則のテストが入口の export を数えて見る。B10-2)。
 */
export const SAFE_REDIRECT_PARTS = Object.freeze([
  Object.freeze({ package: "framework/runtime", file: "src/navigation/server.ts", why: "サーバーの転送 safeRedirect(next/navigation の redirect を包む)" }),
  Object.freeze({ package: "framework/runtime", file: "src/navigation/client.ts", why: "クライアントの遷移 useSafeNavigate(useRouter と location.assign を包む)" }),
  Object.freeze({ package: "framework/runtime", file: "src/http/redirect.ts", why: "Route Handler の転送 safeRedirectResponse(Location を書く)" }),
  Object.freeze({
    package: "framework/adapters/supabase-session",
    file: "src/http-response.ts",
    why: "認証の口の 303(認証基盤のオリジンに一致する認可の URL と、sameOriginPath に通した着地へ。生の部品 redirectResponse はパッケージの中だけで、公開の入口から出さない)",
  }),
]);

/** 安全な部品の案内(報告の文面)。 */
const GUIDE =
  "転送を作れるのは安全な部品だけ: サーバーは safeRedirect(行き先)(@kaninabe/runtime/navigation)、Route Handler は safeRedirectResponse(行き先)(@kaninabe/runtime/http/redirect)、クライアントは useSafeNavigate() の push / replace / assign(@kaninabe/runtime/navigation/client)。どれも行き先を safeReturnPath(同じオリジンの相対パスだけ)に通す(ASVS V3.7.2)。";

/**
 * 規則の 1 回の実行の文脈(報告の口とスコープの解決)。
 *
 * @typedef {{ sourceCode: import("eslint").SourceCode, report: (node: import("estree").Node, what: string) => void }} Env
 */

/**
 * 参照を値の位置の識別子に絞る。
 *
 * @param {readonly import("eslint").Scope.Reference[]} references - 参照
 * @returns {import("estree").Identifier[]} 値の位置の識別子
 */
function valueIdentifiers(references) {
  return references.filter((reference) => reference.isValueReference !== false && !inTypePosition(reference.identifier)).map((reference) => reference.identifier);
}

/**
 * import の指定子が宣言した変数の、値の参照。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} specifier - import の指定子
 * @returns {import("estree").Identifier[]} 値の参照の識別子
 */
function valueReferences(env, specifier) {
  return valueIdentifiers(env.sourceCode.getDeclaredVariables(specifier).flatMap((variable) => variable.references));
}

/**
 * グローバル(宣言に解決できない名前)の値の参照。
 *
 * @param {Env} env - 文脈
 * @param {string} name - 名前
 * @returns {import("estree").Identifier[]} 参照の識別子
 */
function globalReferences(env, name) {
  const scope = env.sourceCode.scopeManager?.globalScope;
  if (scope === null || scope === undefined) return [];
  const variable = scope.set.get(name);
  const implicit = variable !== undefined && variable.defs.length === 0 ? variable.references : [];
  return valueIdentifiers([...implicit, ...ambientReferences(env, name), ...scope.through.filter((reference) => reference.identifier.name === name)]);
}

/**
 * 同じファイルの `declare const navigation: …` の参照(宣言は型の上の約束だけで、実体はグローバルである。点検 12 回目 B12-3)。
 *
 * @param {Env} env - 文脈
 * @param {string} name - グローバルの名前
 * @returns {readonly import("eslint").Scope.Reference[]} 参照
 */
function ambientReferences(env, name) {
  return (env.sourceCode.scopeManager?.scopes ?? []).flatMap((scope) => {
    const variable = scope.type === "module" || scope.type === "global" ? scope.set.get(name) : undefined;
    const ambient = variable !== undefined && variable.defs.length > 0 && variable.defs.every((definition) => definition.parent?.declare === true);
    return ambient ? variable.references : [];
  });
}

/**
 * 報告の位置(メンバーの頭ならメンバー全体)。
 *
 * @param {import("estree").Node} node - 式
 * @returns {import("estree").Node} 位置
 */
function siteOf(node) {
  return node.parent?.type === "MemberExpression" && node.parent.object === node ? node.parent : node;
}

/**
 * `NextResponse` / `Response` を指す式の使い方を報告する。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} node - 型を指す式
 * @param {string} label - 名前
 */
function checkResponseClass(env, node, label) {
  const reason = classifyResponseClass(node, label);
  if (reason !== null) env.report(siteOf(node), reason);
}

/**
 * `location` の物を指す式の使い方を報告する。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} node - `location` の物を指す式
 */
function checkLocation(env, node) {
  const reason = classifyLocation(node);
  if (reason !== null) env.report(siteOf(node), reason);
}

/**
 * ウィンドウ / `document` を指す式から連ねて分類する(`window.top.location.href = …` まで辿る)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} start - ウィンドウか `document` を指す式
 * @param {boolean} isDocument - `document` か
 */
function checkHost(env, start, isDocument) {
  let host = start;
  let document = isDocument;
  for (let depth = 0; depth < 8; depth += 1) {
    const result = classifyHost(host, document);
    if (result.kind === "ok") return;
    if (result.kind === "report") return env.report(result.node, result.reason ?? "ウィンドウ");
    if (result.kind === "location") return checkLocation(env, result.node);
    if (result.kind === "response") return checkResponseClass(env, result.node, "Response");
    host = result.node;
    document = result.kind === "document";
  }
  env.report(host, "ウィンドウの深い連なり");
}

/**
 * 名前空間の import の参照を分類する(静的な名前のメンバーだけを `onMember` に任せ、残りは赤)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} specifier - 名前空間の指定子
 * @param {string} module - 引いたモジュール
 * @param {(node: import("estree").MemberExpression, name: string) => void} onMember - 名前ごとの判定
 */
function namespaceReferences(env, specifier, module, onMember) {
  for (const identifier of valueReferences(env, specifier)) {
    const parent = identifier.parent;
    if (parent?.type !== "MemberExpression" || parent.object !== identifier) {
      env.report(identifier, `${module} の名前空間の別名・受け渡し`);
      continue;
    }
    const name = propertyName(parent);
    if (name === null) env.report(parent, `${module} の名前空間の計算した鍵`);
    else onMember(parent, name);
  }
}

/**
 * 値の import の指定子 1 つを調べる(`next/navigation` の禁じた名前・`next/server` の `NextResponse` の参照の全部)。
 *
 * @param {Env} env - 文脈
 * @param {string} module - 引いたモジュール
 * @param {import("estree").Node} specifier - 指定子
 */
function checkSpecifier(env, module, specifier) {
  const imported = specifier.type === "ImportSpecifier" ? (specifier.imported.name ?? specifier.imported.value) : null;
  if (module === NAVIGATION_MODULE) {
    if (specifier.type === "ImportNamespaceSpecifier") {
      namespaceReferences(env, specifier, module, (node, name) => {
        if (BANNED_NAVIGATION_NAMES.has(name)) env.report(node, `${module} の ${name}`);
      });
    } else if (specifier.type === "ImportDefaultSpecifier" || BANNED_NAVIGATION_NAMES.has(imported ?? "")) {
      env.report(specifier, `${module} の ${imported ?? "default"}`);
    }
  } else if (module === SERVER_MODULE) {
    if (specifier.type === "ImportNamespaceSpecifier") {
      namespaceReferences(env, specifier, module, (node, name) => {
        if (name === "NextResponse") checkResponseClass(env, node, "NextResponse");
      });
    } else if (specifier.type === "ImportDefaultSpecifier") {
      env.report(specifier, `${module} の default`);
    } else if (imported === "NextResponse") {
      for (const identifier of valueReferences(env, specifier)) checkResponseClass(env, identifier, "NextResponse");
    }
  }
}

/**
 * import を調べる(値の import だけ)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").ImportDeclaration} node - import
 */
function checkImport(env, node) {
  const module = moduleOf(node.source.value);
  if (module === null || node.importKind === "type") return;
  const values = node.specifiers.filter((specifier) => specifier.importKind !== "type");
  if (isBannedModule(module)) {
    if (values.length > 0 || node.specifiers.length === 0) env.report(node, `${module} の import`);
    return;
  }
  for (const specifier of values) checkSpecifier(env, module, specifier);
}

/**
 * 再 export を調べる(`export … from` と `export *`)。束縛を辿れない形になるので、転送の口を含むものは赤。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").ExportNamedDeclaration | import("estree").ExportAllDeclaration} node - export
 */
function checkReexport(env, node) {
  const module = moduleOf(node.source?.value);
  if (module === null || node.exportKind === "type") return;
  if (isBannedModule(module)) return env.report(node, `${module} の再 export`);
  if (node.type === "ExportAllDeclaration") {
    if (module === NAVIGATION_MODULE || module === SERVER_MODULE) env.report(node, `${module} の export *`);
    return;
  }
  for (const specifier of node.specifiers) {
    if (specifier.exportKind === "type") continue;
    const local = specifier.local.name ?? specifier.local.value;
    if ((module === NAVIGATION_MODULE && (BANNED_NAVIGATION_NAMES.has(local) || local === "default")) || (module === SERVER_MODULE && local === "NextResponse")) {
      env.report(specifier, `${module} の ${local} の再 export`);
    }
  }
}

/**
 * 動的 import / require の指定子を調べる(名前空間が返るので束縛を辿れない。転送の口を持つモジュールは赤)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} node - 位置
 * @param {import("estree").Node | undefined} source - 指定子の式
 */
function checkDynamicModule(env, node, source) {
  const module = moduleOf(stringValue(source));
  if (module === null) return;
  if (isBannedModule(module) || module === NAVIGATION_MODULE || module === SERVER_MODULE) env.report(node, `${module} の動的な読み込み`);
}

/**
 * 識別子の宣言を引く口(`const` / `let` の初期化子と、関数の宣言)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Node} node - 位置
 * @returns {(name: string) => { kind: "function" | "init", init: import("estree").Node | null } | null} 引く口
 */
function resolverAt(env, node) {
  const scope = env.sourceCode.getScope(node);
  return (name) => {
    const definition = findVariable(scope, name)?.defs[0];
    if (definition?.type === "FunctionName") return { kind: "function", init: null };
    if (definition?.type === "Variable" && definition.node.id.type === "Identifier") return { kind: "init", init: definition.node.init ?? null };
    return null;
  };
}

/**
 * `.set` / `.append` の呼び出しの鍵を調べる(**相手が何であれ**、第 1 引数の名前で決める。点検 10 回目 B10-1 ——
 * 相手の名前で見分けると、`const h = response.headers; h.set('Location', …)` のような別名を取りこぼす)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").CallExpression} node - 呼び出し
 */
function checkHeaderCall(env, node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || !["set", "append"].includes(propertyName(callee) ?? "")) return;
  const key = node.arguments[0];
  const resolve = resolverAt(env, node);
  const name = stringValue(key) ?? (key?.type === "Identifier" ? stringValue(resolve(key.name)?.init) : null);
  if (isRedirectHeader(name)) env.report(node, `見出しの ${name}`);
}

/**
 * オブジェクトの鍵を調べる(見出しの `Location` / `Refresh` は**位置を問わず**大文字小文字を問わない。値が関数の鍵は見出しでない。
 * あわせて `http-equiv: refresh` の props)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").Property} node - プロパティ
 */
function checkProperty(env, node) {
  if (node.parent?.type !== "ObjectExpression") return;
  const name = keyName(node);
  if (name === null) return;
  if (isRedirectHeaderProperty(node, resolverAt(env, node))) {
    env.report(node, `見出しの ${name}`);
    return;
  }
  if (/^http-?equiv$/iu.test(name)) {
    const value = stringValue(node.value);
    if (value === null || value.toLowerCase() === "refresh") env.report(node, "http-equiv=refresh");
  }
}

/**
 * メンバーへの代入の左辺を調べる(`headers['Location'] = …`・`h.location = …`。名前は大文字小文字を問わず、値が関数なら見出しでない)。
 * `location` の物への代入(`window.location = …`)はグローバルの検査も同じ節を報告する(報告は節ごとに 1 回)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree").AssignmentExpression} node - 代入
 */
function checkMemberAssignment(env, node) {
  if (node.left.type !== "MemberExpression") return;
  const name = propertyName(node.left);
  if (!isRedirectHeader(name) || isFunctionValue(node.right, resolverAt(env, node))) return;
  env.report(node.left, `見出しの ${name} への代入`);
}

/**
 * JSX の `http-equiv` / `httpEquiv` 属性を調べる(値が式なら辿れないので赤)。
 *
 * @param {Env} env - 文脈
 * @param {import("estree-jsx").JSXAttribute} node - 属性
 */
function checkJsxAttribute(env, node) {
  const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
  if (name === null || !/^http-?equiv$/iu.test(name)) return;
  const value = node.value?.type === "JSXExpressionContainer" ? stringValue(node.value.expression) : stringValue(node.value);
  if (value === null || value.toLowerCase() === "refresh") env.report(node, "<meta http-equiv=refresh>");
}

/**
 * グローバルの遷移の口(`location`・`Response`・`open`・`navigation`・ウィンドウ・`document`)の参照を全部調べる。
 *
 * @param {Env} env - 文脈
 */
function checkGlobals(env) {
  for (const identifier of globalReferences(env, "location")) checkLocation(env, identifier);
  for (const identifier of globalReferences(env, "Response")) checkResponseClass(env, identifier, "Response");
  for (const identifier of globalReferences(env, "open")) env.report(identifier, "open(window.open)");
  for (const identifier of globalReferences(env, "navigation")) env.report(identifier, "navigation(Navigation API の navigate)");
  for (const name of WINDOW_HOSTS) for (const identifier of globalReferences(env, name)) checkHost(env, identifier, false);
  for (const identifier of globalReferences(env, "document")) checkHost(env, identifier, true);
}

/** @type {import("eslint").Rule.RuleModule} */
export const requireSafeRedirect = {
  meta: {
    type: "problem",
    docs: { description: "転送は安全な部品(safeRedirect / safeRedirectResponse / useSafeNavigate)だけで作らせる。生の転送の口は使った時点で違反" },
    schema: [],
    messages: { raw: `{{what}} は生の転送の口です。${GUIDE}` },
  },
  create(context) {
    /** @type {Set<import("estree").Node>} */
    const reported = new Set();
    /** @type {Env} */
    const env = {
      sourceCode: context.sourceCode,
      report(node, what) {
        if (reported.has(node)) return;
        reported.add(node);
        context.report({ node, messageId: "raw", data: { what } });
      },
    };
    return {
      ImportDeclaration: (node) => checkImport(env, node),
      ExportNamedDeclaration: (node) => checkReexport(env, node),
      ExportAllDeclaration: (node) => checkReexport(env, node),
      ImportExpression: (node) => checkDynamicModule(env, node, node.source),
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require" && (findVariable(env.sourceCode.getScope(node), "require")?.defs.length ?? 0) === 0) {
          checkDynamicModule(env, node, node.arguments[0]);
        }
        checkHeaderCall(env, node);
      },
      Property: (node) => checkProperty(env, node),
      AssignmentExpression: (node) => checkMemberAssignment(env, node),
      ArrayExpression(node) {
        // 見出しの組の並び(`[['Location', x]]` / `new Headers([[…]])`)の 1 組。外の並びの中にある 2 要素だけを見る。
        const name = stringValue(node.elements[0]);
        if (node.parent?.type === "ArrayExpression" && node.elements.length === 2 && isRedirectHeader(name)) env.report(node, `見出しの ${name}`);
      },
      JSXAttribute: (node) => checkJsxAttribute(env, node),
      // `el.ownerDocument` は `document` そのもの(点検 11 回目 B11-6)。クライアントの遷移に実行時の関所は無いので、この規則が主の守りである。
      MemberExpression(node) {
        if (propertyName(node) === "ownerDocument") checkHost(env, node, true);
      },
      "Program:exit": () => checkGlobals(env),
    };
  },
};
