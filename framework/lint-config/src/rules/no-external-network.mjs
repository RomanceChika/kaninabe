/**
 * ネットワークの口(グローバルの `fetch` / `WebSocket` / `XMLHttpRequest` / `EventSource`)を、
 * 外部連携のアダプタの外から使わせない。ただし**同一オリジンの相対 URL への `fetch`** だけは許す。
 *
 * **なぜ要るのか。** 外部連携の閉世界(X 群)は `app/src/infrastructure/` 直下の**ディレクトリ**を
 * 外部連携のカタログと突き合わせる。`fetch` は import ではなくグローバルなので、層境界
 * (import の向き)にも掛からず、Route Handler や operation 層からでもカタログの宣言(`sends`)を経ずに
 * 外へ送れた —— 網の穴探し 2026-10-06 の M03(Route Handler に `fetch('https://collector.example.com/…')`
 * を 1 行足しても全検査が緑。同じ送信を `infrastructure/slack/` に置くと X1 が赤になる = M35)。
 *
 * **許すのは 1 つだけ**: `fetch` の第 1 引数が**同一オリジンの相対パス**と静的に分かる形
 * (`'/api/...'` の文字列リテラル・先頭が `/` + 1 文字以上のテンプレート・それらを `const` で束ねた識別子)。
 * 自分の Route Handler を叩くクライアント側の呼び出しがこれで、行き先がオリジンの外に出ない。
 * `//host/...`(プロトコル相対)と `/${x}`(先頭の `/` のあとが式)は許さない(`//` に化けうる)。
 *
 * 使い方(ファイルの範囲)は設定側が決める。**アダプタの住所(`src/infrastructure/**`)だけを外して**
 * それ以外の製品コードに掛ける(仕組み側の `@kaninabe/runtime` の `src` には外さずに掛ける。そこにはアダプタが無い)
 * —— 外す範囲は「外へ出てよい場所」の宣言そのものなので、免除の口は他に無い。
 *
 * **塞いでいる形**(どれも `fetch` 等を別の入口から呼ぶ形で、名前の禁止だけでは素通りになる):
 *   - `globalThis` / `window` / `self` / `top` / `parent` / `frames` を経由した参照
 *     (`window.fetch(…)` / `self['fetch'](…)` / `globalThis.window.fetch(…)`)と `navigator.sendBeacon`
 *     (`window.navigator.sendBeacon(…)` も)
 *   - 上のオブジェクトを TS のラッパ(`as` / `!` / `satisfies` / `<T>x` / `?.`)でくるんだもの
 *   - 上のオブジェクトを `const` に束ねた別名(`const g = globalThis; g.fetch(…)`)
 *   - 上のオブジェクトからの分割代入(`const { fetch } = globalThis` / 引数の既定値 / 代入式 / `...rest`)。
 *     取り出した名前は自前の宣言に見えて参照の検査から外れるので、取り出した時点で報告する
 *   - 相対 URL に見せかけた形(`'/\t/host'` / `'/\n/host'`。URL のパーサがタブと改行を削るので `//host` に化ける)
 *
 * **下限として残る形**(静的に行き先の入口が決まらないので、この規則は見ない。規約で書かない):
 *   - 計算した鍵・関数経由の取り出し(`globalThis[key]` / `Reflect.get(globalThis, 'fetch')` /
 *     `Object.getOwnPropertyDescriptor(globalThis, 'fetch')`)
 *   - 動的 `import()` で外へ送るパッケージを読む形(`await import('undici')`)。静的な `import` と
 *     `node:` 組み込みの動的 import は層境界(boundaries)が止めるが、未解決の名前の動的 import は止まらない
 *   - `let` / `var` で束ねたあとに別のオブジェクトを代入し直して辿る形(別名は初期値だけを見る)
 */

/** 禁止するグローバルの名前。 */
const NETWORK_GLOBALS = new Set(['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource']);

/** グローバルを持つオブジェクト(`globalThis.fetch` 等)。 */
const GLOBAL_HOLDERS = new Set(['globalThis', 'window', 'self', 'top', 'parent', 'frames']);

/** `navigator` から送る口。 */
const NAVIGATOR_SENDERS = new Set(['sendBeacon']);

/**
 * 同一オリジンの相対パスの先頭(`/` のあとにパスの文字が 1 つ以上)。`//` と `/\` は含まない。
 * **タブと改行も含まない** —— URL のパーサは文字列の中のタブ・改行を削るので、`'/\t/host'` は
 * `//host`(プロトコル相対 = 別オリジン)になる。
 */
const SAME_ORIGIN_PATH = /^\/[^/\\\t\n\r]/;

/** 値を変えずに包むだけの TS / 式のラッパ(`x as T` / `x!` / `x satisfies T` / `<T>x` / `x?.`)。 */
const WRAPPERS = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

/**
 * ラッパを剥がした中身を返す。
 *
 * @param {import("estree").Node} node - 見るノード
 * @returns {import("estree").Node} ラッパを剥がしたノード
 */
export function unwrap(node) {
  let current = node;
  while (WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

/**
 * 識別子 `name` を現在のスコープから解決した変数を返す(無ければ null)。
 *
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {string} name - 識別子名
 * @returns {import("eslint").Scope.Variable | null} 見つかった変数
 */
export function findVariable(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable !== undefined) return variable;
  }
  return null;
}

/**
 * 文字列の値が静的に分かるノードから、同一オリジンの相対パスかを判定する。
 *
 * @param {import("estree").Node | undefined} rawNode - `fetch` の第 1 引数
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ(識別子を `const` に辿るため)
 * @param {number} depth - 識別子を辿った回数(循環の安全弁)
 * @returns {boolean} 同一オリジンの相対パスと分かるなら true
 */
function isSameOriginPath(rawNode, scope, depth = 0) {
  if (rawNode === undefined) return false;
  // `'/api/x' as const` のように値を変えないラッパは剥がして読む。
  const node = unwrap(rawNode);
  if (node.type === "Literal") return typeof node.value === "string" && SAME_ORIGIN_PATH.test(node.value);
  if (node.type === "TemplateLiteral") {
    const head = node.quasis[0]?.value.cooked;
    return typeof head === "string" && SAME_ORIGIN_PATH.test(head);
  }
  if (node.type !== "Identifier" || depth > 2) return false;
  const variable = findVariable(scope, node.name);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const") return false;
  return isSameOriginPath(definition.node.init ?? undefined, variable.scope, depth + 1);
}

/**
 * 送る呼び出しとして許される形か(`fetch(<同一オリジンの相対パス>, …)`)。
 *
 * @param {import("estree").Node} callee - 呼び出される側(識別子 or メンバ参照)
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {string} property - 呼び出しの名前(`fetch` のとき以外は許さない)
 * @returns {boolean} 許されるなら true
 */
function isAllowedCall(callee, scope, property) {
  const call = callee.parent;
  if (property !== "fetch" || call?.type !== "CallExpression" || call.callee !== callee) return false;
  return isSameOriginPath(call.arguments[0], scope);
}

/** メンバ参照の名前(`a.b` / `a['b']`)。静的に決まらなければ null。 */
export function memberName(node) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }
  return null;
}

/**
 * そのノードが「グローバルのネットワークの口を持つオブジェクト」か(`globalThis` 等なら "global"、
 * `navigator` なら "navigator"、どちらでもなければ null)。
 *
 * TS のラッパを剥がし、`window.navigator` / `globalThis.window` のような入れ子と、`const g = globalThis`
 * のような**1 回だけ束ねた別名**を辿る。自前の宣言(引数・import 等)の同名は対象外。
 *
 * @param {import("estree").Node} rawNode - 見るノード
 * @param {import("eslint").Scope.Scope} scope - 起点のスコープ
 * @param {number} depth - 辿った回数(循環の安全弁)
 * @returns {"global" | "navigator" | null} 持ち主の種類
 */
export function holderKind(rawNode, scope, depth = 0) {
  if (depth > 4) return null;
  const node = unwrap(rawNode);
  if (node.type === "MemberExpression") {
    const name = memberName(node);
    if (name === null || holderKind(node.object, scope, depth + 1) !== "global") return null;
    if (GLOBAL_HOLDERS.has(name)) return "global";
    return name === "navigator" ? "navigator" : null;
  }
  if (node.type !== "Identifier") return null;
  const variable = findVariable(scope, node.name);
  if (variable === null || variable.defs.length === 0) {
    if (GLOBAL_HOLDERS.has(node.name)) return "global";
    return node.name === "navigator" ? "navigator" : null;
  }
  const definition = variable.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable" || definition.node.id.type !== "Identifier" || !definition.node.init) return null;
  return holderKind(definition.node.init, variable.scope, depth + 1);
}

/**
 * 分割代入のパターンが、持ち主からネットワークの口を取り出しているか(入れ子・`...rest` も見る)。
 *
 * @param {import("estree").Node} pattern - `{ fetch, navigator: { sendBeacon } }` のようなパターン
 * @param {"global" | "navigator"} kind - 取り出し元の種類
 * @returns {boolean} 取り出していれば true
 */
function patternTakesSender(pattern, kind) {
  if (pattern.type !== "ObjectPattern") return false;
  return pattern.properties.some((property) => {
    if (property.type === "RestElement") return true;
    const name = memberName({ computed: property.computed, property: property.key });
    if (name === null) return false;
    if (kind === "navigator") return NAVIGATOR_SENDERS.has(name);
    if (NETWORK_GLOBALS.has(name)) return true;
    const inner = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
    if (GLOBAL_HOLDERS.has(name)) return patternTakesSender(inner, "global");
    return name === "navigator" && patternTakesSender(inner, "navigator");
  });
}

/** @type {import("eslint").Rule.RuleModule} */
export const noExternalNetwork = {
  meta: {
    type: "problem",
    docs: {
      description:
        "グローバルのネットワークの口(fetch / WebSocket / XMLHttpRequest / EventSource)を、外部連携のアダプタの外から使わせない(同一オリジンの相対パスへの fetch だけ許す)",
    },
    schema: [],
    messages: {
      global:
        "グローバルの `{{name}}` を、外部連携のアダプタ(src/infrastructure/**)の外から使わない。外へ送る口は外部連携のカタログ(external.md)に載せてアダプタに置く(X 群が見る)。自分のサーバーを叩くだけなら、`fetch('/api/…')` のように同一オリジンの相対パスをそのまま書く(`//` や `/${x}` のように行き先が式になる形は許されない)。",
      holder:
        "`{{holder}}.{{name}}` でグローバルのネットワークの口を呼ばない。外部連携のアダプタ(src/infrastructure/**)に置く(同一オリジンの相対パスへの fetch だけは許される)。",
      destructure:
        "`globalThis` / `window` / `self` / `navigator` からネットワークの口(fetch / WebSocket / XMLHttpRequest / EventSource / sendBeacon)を分割代入で取り出さない(取り出した名前は自前の宣言に見えて、行き先の検査から外れる)。外部連携のアダプタ(src/infrastructure/**)に置く。",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const checkDestructure = (pattern, source, node) => {
      if (!source || pattern.type !== "ObjectPattern") return;
      const kind = holderKind(source, sourceCode.getScope(node));
      if (kind !== null && patternTakesSender(pattern, kind)) context.report({ node: pattern, messageId: "destructure" });
    };
    return {
      Program(program) {
        const scope = sourceCode.getScope(program);
        const global = scope.type === "global" ? scope : scope.upper;
        if (global === null) return;
        const references = [
          ...global.through,
          ...[...NETWORK_GLOBALS].flatMap((name) => global.set.get(name)?.references ?? []),
        ];
        const seen = new Set();
        for (const reference of references) {
          const node = reference.identifier;
          if (seen.has(node) || !NETWORK_GLOBALS.has(node.name)) continue;
          seen.add(node);
          // 自前の宣言(同名の変数・関数)を指す参照は対象外。
          if (reference.resolved !== null && reference.resolved.defs.length > 0) continue;
          // 型の位置(`typeof fetch`)は呼び出しではない。
          if (node.parent?.type === "TSTypeQuery") continue;
          if (isAllowedCall(node, sourceCode.getScope(node), node.name)) continue;
          context.report({ node, messageId: "global", data: { name: node.name } });
        }
      },
      MemberExpression(node) {
        const name = memberName(node);
        if (name === null) return;
        const scope = sourceCode.getScope(node);
        const kind = holderKind(node.object, scope);
        const sends =
          (kind === "global" && NETWORK_GLOBALS.has(name)) || (kind === "navigator" && NAVIGATOR_SENDERS.has(name));
        if (!sends || isAllowedCall(node, scope, name)) return;
        context.report({ node, messageId: "holder", data: { holder: sourceCode.getText(node.object), name } });
      },
      // 分割代入で取り出した名前は自前の宣言に見えるので、取り出した時点で報告する。
      VariableDeclarator: (node) => checkDestructure(node.id, node.init, node),
      AssignmentExpression: (node) => checkDestructure(node.left, node.right, node),
      AssignmentPattern: (node) => checkDestructure(node.left, node.right, node),
    };
  },
};
