/**
 * 手書きの基盤の層(`src/infrastructure/**`)が、DB の失敗を**素の例外に詰めて投げる**形を止める(点検 19 回目 B19-1・20 回目 C20-6)。
 *
 * `throw new Error(\`insert_entry に失敗しました: ${error.message}\`)` の形は、SQLSTATE とコミットの状態を捨てる。
 * 巻き戻りが確実な失敗(`40P01`)も、届いたか分からない通信の失敗も、同じ「想定外」の文字列になり、記録も画面も区別できない。
 * また DB の文言(関数名・表名・`deadlock detected`)が例外のメッセージに入り、隠しの外れた環境で利用者へ出る。
 *
 * 失敗は `@kaninabe/adapter-postgrest` の `dbFailure(where, error)` で作る(`DbInfrastructureError`。種類・コミットの状態・SQLSTATE を欄に持ち、
 * DB の文言は `cause` にだけ入れる)。実行計画の口は `settle()` が同じ型を投げる。
 *
 * 止める形(`throw` の式が `dbFailure(...)` の呼び出しでないとき):
 * 1. **DB の結果の `error` を読む**(読む側で見る。綴りに依らない): 分割代入で受けた `{ error }` / `{ error: e }`(とそれから分割代入・代入で
 *    写した名前)・`<式>.error` を、投げる式のどこかで参照する。`throw error`(素の PostgrestError)・`${error}`・`String(error)`・
 *    `error.code`・`JSON.stringify(error)`・`new TypeError(error.message)`・`const { message } = error; throw new Error(message)` のどれも赤。
 * 2. 投げる式のどこかで `.message` を読む(`Error` に限らずどの例外の型でも)。`catch (e)` の `e.message` を詰め直す形もここで止まる。
 *
 * **行が無い・時刻が無いなどの、DB の文言を含まない診断の `Error` は対象外**(SQLSTATE を持たないので失うものが無い)。DB の結果の `error` を
 * 例外の選択の `cause` の値にそのまま入れる形(`new Error('…', { cause: error })`)も対象外 —— 文言に DB の文言が載らず、欄は `cause` に残る
 * (認証基盤の管理 API の失敗のような、PostgREST でない結果の `error` の受け口。DB の RPC の失敗は `dbFailure` を使う)。
 * 汚れの起点は、変数の宣言・代入・**関数の引数**の分割代入(`.then(({ error }) => …)`)。投げる形は `throw` のほか、Promise を拒否で
 * 終える呼び出し(Promise の静的な拒否の関数と、executor の第 2 引数の名前の関数)も同じに見る(点検 21 回目 C21-7)。
 * 見ない下限: 関数の引数で受け取った `error`(分割代入でなく `(error) => …` で値を受ける形)・`error` 以外の名前の欄に入った DB の失敗。
 */

/** Promise を拒否で終える関数の名前(API の関数の名前そのもの)。 */
const REJECTION = Promise.reject.name;

/** 正しい作り方(この呼び出しの中は見ない)。 */
const FAILURE_FACTORY = "dbFailure";

/**
 * 式の木の節を全部たどる(`parent` は辿らない)。
 *
 * @param {unknown} node 根
 * @param {(node: import("estree").Node) => boolean} visit 節ごとに呼ぶ(true を返したら止めて true)
 * @returns {boolean} どこかで true
 */
function some(node, visit) {
  if (node === null || typeof node !== "object") return false;
  if ("type" in node && typeof node.type === "string" && visit(/** @type {import("estree").Node} */ (node))) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    if (Array.isArray(value) ? value.some((item) => some(item, visit)) : typeof value === "object" && value !== null && some(value, visit)) return true;
  }
  return false;
}

/**
 * 分割代入の型の中の、`error` の欄から受けた名前(入れ子は見ない)。
 *
 * @param {import("estree").Pattern} pattern 左辺
 * @returns {import("estree").Identifier[]} 名前
 */
function errorBindings(pattern) {
  if (pattern.type !== "ObjectPattern") return [];
  return pattern.properties.flatMap((property) => {
    if (property.type !== "Property" || property.computed || property.key.type !== "Identifier" || property.key.name !== "error") return [];
    const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
    return value.type === "Identifier" ? [value] : [];
  });
}

/**
 * 左辺の名前の全部(写しの伝播用)。
 *
 * @param {import("estree").Pattern} pattern 左辺
 * @returns {import("estree").Identifier[]} 名前
 */
function boundNames(pattern) {
  const found = [];
  some(pattern, (node) => {
    if (node.type === "Identifier") found.push(node);
    return false;
  });
  return found;
}

/**
 * 拒否の呼び出しか(Promise の静的な拒否の関数と、それと同じ名前の関数 = executor の第 2 引数の慣例の名前)。名前は API そのものから引く。
 *
 * @param {import("estree").Node} callee 呼び出しの的
 * @returns {boolean} 拒否なら true
 */
function rejects(callee) {
  if (callee.type === "Identifier") return callee.name === REJECTION;
  return callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.object.name === "Promise" && callee.property.type === "Identifier" && callee.property.name === REJECTION;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noBareDbError = {
  meta: {
    type: "problem",
    docs: { description: "基盤の層で DB の失敗を素の例外に詰めて投げない(SQLSTATE とコミットの状態を失う)" },
    schema: [],
    messages: {
      bare:
        "DB の失敗を素の例外に詰めて投げない(DB の結果の `error` や `.message` を `throw` に載せると、SQLSTATE とコミットの状態が消え、巻き戻りが確実な失敗も区別できない。DB の文言も例外に載る)。`@kaninabe/adapter-postgrest` の `dbFailure(where, error)` を投げる(点検 19 回目 B19-1・20 回目 C20-6)。",
    },
  },
  create(context) {
    const source = context.sourceCode;
    /** DB の結果の `error` を持つ変数(とその写し)。 */
    const tainted = new Set();
    /**
     * 名前の参照が汚れた変数か。
     *
     * @param {import("estree").Identifier} reference 参照
     * @returns {boolean} 汚れていれば true
     */
    const isTainted = (reference) => {
      for (let scope = source.getScope(reference); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(reference.name);
        if (variable !== undefined) return tainted.has(variable);
      }
      return false;
    };
    /**
     * 式が DB の結果の `error` を読むか(汚れた名前の参照・`<式>.error`)。
     *
     * @param {unknown} expression 式
     * @returns {boolean} 読むなら true
     */
    const readsDbError = (expression) =>
      some(expression, (node) => {
        if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === "error") return true;
        if (node.type === "Identifier" && isTainted(node)) {
          const parent = /** @type {{ parent?: import("estree").Node }} */ (node).parent;
          // `{ cause: error }` の値にそのまま入れるのは文言に載らない(欄は cause に残る)。
          if (parent?.type === "Property" && parent.value === node && !parent.computed && parent.key.type === "Identifier" && parent.key.name === "cause") return false;
          // `a.error` の `error`(欄の名前)や `{ error: x }` の鍵は参照でない。
          return !(parent?.type === "MemberExpression" && parent.property === node && !parent.computed) && !(parent?.type === "Property" && parent.key === node && !parent.computed);
        }
        return false;
      });
    /**
     * 名前を汚れとして登録する(宣言のスコープの変数に結ぶ)。
     *
     * @param {import("estree").Identifier} declared 宣言の名前
     */
    const taint = (declared) => {
      const variable = source.getDeclaredVariables(declared.parent).find((candidate) => candidate.name === declared.name);
      if (variable !== undefined) tainted.add(variable);
      else
        for (let scope = source.getScope(declared); scope !== null; scope = scope.upper) {
          const found = scope.set.get(declared.name);
          if (found !== undefined) {
            tainted.add(found);
            break;
          }
        }
    };
    /**
     * 投げる(拒否する)値が DB の失敗を素の例外に詰めているなら報告する。
     *
     * @param {import("estree").Node | null | undefined} thrown 投げる値
     */
    const checkThrown = (thrown) => {
      if (thrown === null || thrown === undefined || thrown.type === "SpreadElement") return;
      if ((thrown.type === "CallExpression" || thrown.type === "NewExpression") && thrown.callee.type === "Identifier" && thrown.callee.name === FAILURE_FACTORY) return;
      const readsMessage = some(thrown, (inner) => inner.type === "MemberExpression" && !inner.computed && inner.property.type === "Identifier" && inner.property.name === "message");
      if (readsMessage || readsDbError(thrown)) context.report({ node: thrown, messageId: "bare" });
    };
    return {
      VariableDeclarator(node) {
        for (const name of errorBindings(node.id)) taint(name);
        // 写し: `const e = error` / `const { message } = error` / `const m = result.error.message`。
        if (node.init !== null && node.init !== undefined && readsDbError(node.init)) for (const name of boundNames(node.id)) taint(name);
      },
      AssignmentExpression(node) {
        const target = node.left;
        const pattern = /** @type {import("estree").Pattern} */ (target);
        for (const name of errorBindings(pattern)) taint(name);
        if (readsDbError(node.right)) for (const name of boundNames(pattern)) taint(name);
      },
      // 関数の引数の分割代入も汚れの起点にする(`.then(({ error }) => …)`。点検 21 回目 C21-7)。
      ":function"(node) {
        for (const param of node.params) {
          const pattern = param.type === "AssignmentPattern" ? param.left : param;
          for (const name of errorBindings(/** @type {import("estree").Pattern} */ (pattern))) taint(name);
        }
      },
      ThrowStatement(node) {
        checkThrown(node.argument);
      },
      // 投げる代わりに Promise を拒否で終える形も同じに見る(静的な拒否の関数・executor の第 2 引数。点検 21 回目 C21-7)。
      CallExpression(node) {
        if (rejects(node.callee)) checkThrown(node.arguments[0]);
      },
    };
  },
};
