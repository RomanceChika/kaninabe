/**
 * **ログインのトークンをサーバーだけが持つ**(保証 `session_tokens_server_only`)の、製品コードの側の執行者。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-1 / §6-7(案 A。ASVS V3.3.4 / V10.1.1)
 *
 * セッションの cookie は `HttpOnly` で、書き手はセッションの adapter(`@kaninabe/adapter-supabase-session`)の 1 か所だけである。
 * 製品のコードがその形を崩す書き方は 4 つあり、どれも import や型では止まらないので、ここで字面で止める:
 *
 *   1. **`@supabase/ssr` を製品から import する**(`import-ssr`)—— ブラウザのクライアント(`createBrowserClient`)も、属性を自分で選ぶ
 *      サーバーのクライアントも、ここから作れてしまう。クライアントの作り方は adapter の `createSessionClient` だけにする
 *   2. **`'use client'` のファイルから認証基盤のパッケージを import する**(`client-import`)—— `@supabase/*` とセッションの adapter。
 *      ブラウザから認証基盤へ直接つなぐ道を作らない(Realtime などの直接の接続も既定では作らない。§6-6)
 *   3. **`document.cookie` / `cookieStore` に触れる**(`document-cookie`)—— 認証の cookie はスクリプトから読めず、書くのはサーバーの口だけ。
 *      スクリプトが書く cookie は `Secure` も `HttpOnly` も付かない(招待コードの cookie がそうだった)
 *   4. **トークンの欄(`access_token` / `refresh_token` / `provider_token` / `provider_refresh_token`)を読む**(`token-field`)——
 *      V3.3.4 の後半「値は `Set-Cookie` でしかクライアントに渡さない」。欄を読めなければ、画面の props・Server Action の戻り値・ログに
 *      載せる経路が字面の上で無くなる(読むのは adapter と認証基盤のライブラリの中だけ)
 *
 * 掛ける範囲は設定側が決める(製品の `src` の、テストと支援コードを除く全部。テストは本物のセッションを作るためにトークンを読む)。
 * **下限として残る形**: 計算した鍵(`session[key]`)・文字列を組み立てた欄名・`eval` の類は静的に決まらないので見ない(規約で書かない)。
 */

/** トークンの欄の名前(認証基盤の応答の綴り)。 */
const TOKEN_FIELDS = new Set(["access_token", "refresh_token", "provider_token", "provider_refresh_token"]);

/** 認証基盤のパッケージ(ブラウザの部品から import してはならない)。 */
const AUTH_PLATFORM_SOURCE = /^(?:@supabase\/|@kaninabe\/adapter-supabase-session(?:\/|$))/;

/** サーバーのクライアントを自分で作れてしまうパッケージ(製品から import してはならない)。 */
const SSR_SOURCE = /^@supabase\/ssr(?:\/|$)/;

/** グローバルを持つオブジェクト(`window.document.cookie` 等)。 */
const GLOBAL_HOLDERS = new Set(["globalThis", "window", "self"]);

/**
 * メンバ参照・プロパティの名前(静的に決まらなければ null)。
 *
 * @param {boolean} computed - `a[b]` の形か
 * @param {import("estree").Node} key - プロパティのノード
 * @returns {string | null} 名前
 */
function staticName(computed, key) {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/**
 * ファイルが `'use client'` の指示で始まるか。
 *
 * @param {import("estree").Node} file - ファイルの根のノード
 * @returns {boolean} クライアントの部品なら true
 */
function isClientModule(file) {
  for (const statement of file.body) {
    if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") return false;
    if (statement.directive === "use client") return true;
  }
  return false;
}

/**
 * `document`(か、`window.document` などの入れ子)を指すノードか。
 *
 * @param {import("estree").Node} node - 見るノード
 * @returns {boolean} document なら true
 */
function isDocument(node) {
  if (node.type === "Identifier") return node.name === "document";
  if (node.type !== "MemberExpression") return false;
  const name = staticName(node.computed, node.property);
  return name === "document" && node.object.type === "Identifier" && GLOBAL_HOLDERS.has(node.object.name);
}

/** @type {import("eslint").Rule.RuleModule} */
export const sessionTokensServerOnly = {
  meta: {
    type: "problem",
    docs: {
      description:
        "ログインのトークンをサーバーだけが持つ形を崩す書き方(@supabase/ssr の import・クライアントの部品からの認証基盤の import・document.cookie・トークンの欄の読み取り)を止める",
    },
    schema: [],
    messages: {
      "import-ssr":
        "製品のコードから @supabase/ssr を import しない。セッションのクライアントはセッションの adapter(@kaninabe/adapter-supabase-session の createSessionClient)だけが作る(cookie の属性を約束どおりにするため。server-only-session.md)。",
      "client-import":
        "'use client' のファイルから認証基盤のパッケージ({{source}})を import しない。ブラウザは認証基盤に直接つながず、サインインの開始・ログアウトはサーバーの口(フォームの POST)で行う(server-only-session.md §6-2)。",
      "document-cookie":
        "スクリプトから cookie に触れない(document.cookie / cookieStore)。認証の cookie はスクリプトから読めず、書くのはサーバーの口だけ(スクリプトが書く cookie には Secure も HttpOnly も付かない)。運ぶ値はフォームの本文でサーバーへ送る。",
      "token-field":
        "トークンの欄({{name}})を読まない。トークンは Set-Cookie でしかクライアントに渡さない(ASVS V3.3.4)—— 画面の props・Server Action の戻り値・ログに載る経路を作らない。セッションから要るのは実行者の ID とセッションの属性だけ。",
    },
  },
  create(context) {
    let clientModule = false;
    const checkImport = (node, source) => {
      if (typeof source !== "string") return;
      if (SSR_SOURCE.test(source)) context.report({ node, messageId: "import-ssr" });
      else if (clientModule && AUTH_PLATFORM_SOURCE.test(source)) context.report({ node, messageId: "client-import", data: { source } });
    };
    return {
      Program(program) {
        clientModule = isClientModule(program);
      },
      ImportDeclaration: (node) => checkImport(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && checkImport(node, node.source.value),
      ExportAllDeclaration: (node) => checkImport(node, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && checkImport(node, node.source.value),
      MemberExpression(node) {
        const name = staticName(node.computed, node.property);
        if (name === null) return;
        if (name === "cookie" && isDocument(node.object)) context.report({ node, messageId: "document-cookie" });
        else if (name === "cookieStore" && node.object.type === "Identifier" && GLOBAL_HOLDERS.has(node.object.name)) {
          context.report({ node, messageId: "document-cookie" });
        } else if (TOKEN_FIELDS.has(name)) context.report({ node, messageId: "token-field", data: { name } });
      },
      Identifier(node) {
        // 素の `cookieStore`(グローバル)。自前の宣言・プロパティの名前は対象外。
        if (node.name !== "cookieStore") return;
        const parent = node.parent;
        if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        if (parent?.type === "Property" && parent.key === node && !parent.computed) return;
        const scope = (context.sourceCode ?? context.getSourceCode()).getScope(node);
        for (let current = scope; current !== null; current = current.upper) {
          if (current.set.get("cookieStore")?.defs.length) return;
        }
        context.report({ node, messageId: "document-cookie" });
      },
      // 分割代入でトークンの欄を取り出す形(`const { access_token } = session`)。
      Property(node) {
        if (node.parent?.type !== "ObjectPattern") return;
        const name = staticName(node.computed, node.key);
        if (name !== null && TOKEN_FIELDS.has(name)) context.report({ node, messageId: "token-field", data: { name } });
      },
    };
  },
};
