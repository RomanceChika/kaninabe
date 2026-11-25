/**
 * 写像（`src/infrastructure/**​/queries.ts` / `*-queries.ts`）で、埋め込みリソースの列
 * （PostgREST のドット表記。例: `entry_participants.workshop_id`）を、関数の仮引数で直接
 * `.eq()` / `.in()` するのを禁止するローカルルール。
 *
 * 併読（`includes`）を `== param.{name}` で絞る条件は、`query_spec` から生成される
 * `queryParamConditions`（`@/domain/generated/query-windows`。code-query-windows.ts）に
 * 列パスとして出るようになった。適用口は `applyParamConditions`
 * （infrastructure/supabase/query-window.ts）の 1 つに絞る —— actor のスコープ条件を
 * `applyActorConditions` 1 箇所に絞った Q8（`QUERY_RESTRICTED_SYNTAX` の actorId 禁則）と
 * 同じ考え方を、実行時入力（param）で併読を絞る条件にも広げたものである。
 *
 * ドットを含まない列（`source` 自身の列。例: `.eq('workshop_id', workshopId)`）は対象外にする。
 * `source` の絞り込みは配線が受け取る主引数そのもので、型で 1 対 1 の対応が既に見えている
 * （併読のように暗黙に埋め込みへ伝播する曖昧さが無い）ため、線引きを分けている
 * （code-query-windows.ts の同じ線引きと対になる）。
 *
 * 識別子が「関数の仮引数」由来かどうかはスコープ解析で見る。これにより、生成された定数
 * （`entryNonFinalStates` のようなモジュールの import）を使うドット付きの `.in()` 呼び出し
 * （例: `.in('entries.state', entryNonFinalStates)`。UX の filters であって param 絞り込みではない）
 * を誤って落とさない。
 */

const DOTTED_COLUMN = /\./;
const NARROWING_METHODS = new Set(["eq", "in"]);

/**
 * 識別子ノードが、直近の外側の関数の仮引数として束縛されているかを調べる。
 *
 * @param context - ESLint のルールコンテキスト
 * @param node - 調べる Identifier ノード（呼び出しの第 2 引数）
 * @returns 仮引数由来（かつそれ以外の束縛を持たない）なら true
 */
function isFunctionParameter(context, node) {
  const scope = context.sourceCode.getScope(node);
  const reference = scope.references.find((candidate) => candidate.identifier === node);
  const variable = reference?.resolved;
  if (variable === undefined || variable === null || variable.defs.length === 0) return false;
  return variable.defs.every((def) => def.type === "Parameter");
}

/** @type {import("eslint").Rule.RuleModule} */
export const queryParamWindow = {
  meta: {
    type: "problem",
    docs: {
      description:
        "写像で併読先の埋め込み列を関数の引数（実行時入力）で直接絞り込むのを禁止し、生成された param 条件（applyParamConditions）を通す",
    },
    schema: [],
    messages: {
      rawParamFilter:
        "併読先の列（{{column}}）を実行時入力の変数で直接絞り込むのは禁止。スコープ条件と同じく、決定的な写しは query_spec の includes.filters（`== param.x`）から生成される（`queryParamConditions` / `applyParamConditions`。infrastructure/supabase/query-window.ts）。query_spec に条件を宣言して generate すること。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.property.type !== "Identifier") return;
        if (!NARROWING_METHODS.has(node.callee.property.name)) return;

        const [columnArg, valueArg] = node.arguments;
        if (columnArg === undefined || columnArg.type !== "Literal") return;
        if (typeof columnArg.value !== "string" || !DOTTED_COLUMN.test(columnArg.value)) return;
        if (valueArg === undefined || valueArg.type !== "Identifier") return;
        if (!isFunctionParameter(context, valueArg)) return;

        context.report({ node, messageId: "rawParamFilter", data: { column: columnArg.value } });
      },
    };
  },
};
