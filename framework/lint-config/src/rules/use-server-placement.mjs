/**
 * `'use server'` の指令の置き場を許可表で閉じる自作規則(7 回目 C7-1)。
 *
 * Server Action は**ファイル名でなく本文の指令**で決まる POST の口である(ファイル先頭の `'use server'` の export と、関数本体の先頭の
 * `'use server'` の関数)。HTTP の入口の閉世界(J2)は名前の表で口を数えるので、指令はそこに現れない。Server Action の閉世界は
 * 「`src/app/_actions/<集約>/<操作>.ts` が仕様の action と 1 対 1」(構造テストと `layer/action-naming`)だが、それは `_actions` の中の
 * 名前の規則で、`_actions` の外の部品のファイル・ページの中の関数に指令を書けば、仕様の宣言(認可・出どころ・拒否の記録)の外の口になった。
 *
 * 許すのは **`allowFileDirective: true` を渡された置き場(製品の設定で `src/app/_actions/**` だけ)の、ファイルの先頭の指令(prologue)**
 * だけ。次は全部 error:
 *
 * | 形 | messageId |
 * |---|---|
 * | 許されていない置き場のファイルの先頭の指令(注釈の後ろでも・二重引用符でも) | `file` |
 * | 関数本体の中の指令(`_actions` の中でも。インラインの Server Action は作らない) | `inline` |
 * | 指令の位置でない文としての `'use server'`(先頭の指令の並びの後ろ) | `stray` |
 *
 * 文字列の値で見る(`'use server'` のようなエスケープも同じ値なので拾う)。テンプレートの文字列は指令にならないので見ない。
 */

/** 指令の値。 */
const USE_SERVER = "use server";

/**
 * 文が `'use server'` の文字列だけの式文か。
 *
 * @param statement 文のノード
 * @returns そうなら true
 */
function isUseServerStatement(statement) {
  return (
    statement.type === "ExpressionStatement" &&
    statement.expression.type === "Literal" &&
    statement.expression.value === USE_SERVER
  );
}

/**
 * 本文の先頭の指令の並び(文字列だけの式文が続く間)に入っている文の集合。
 *
 * @param body 文の並び
 * @returns prologue の文
 */
function prologueOf(body) {
  const prologue = new Set();
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "Literal" || typeof statement.expression.value !== "string") break;
    prologue.add(statement);
  }
  return prologue;
}

/** @type {import("eslint").Rule.RuleModule} */
export const useServerPlacement = {
  meta: {
    type: "problem",
    docs: {
      description: "'use server' の指令は src/app/_actions/** のファイルの先頭だけに置く(Server Action の口を宣言の外に作らない)",
    },
    schema: [
      {
        type: "object",
        properties: { allowFileDirective: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      file: "'use server' のファイルは src/app/_actions/<集約>/<操作>.ts(仕様の action と 1 対 1 の生成物か runner: manual の宣言の手書き)だけに置ける。ここに書くと宣言(認可・出どころ・拒否の記録)の外の POST の口になる — action_spec を書いて generate する",
      inline: "関数本体の中の 'use server'(インラインの Server Action)は書けない。宣言の外の POST の口になる — action_spec を書いて generate し、_actions の生成物を使う",
      stray: "'use server' の文字列の文は指令の位置(ファイルの先頭)以外に書けない(指令に見えて効かない、または紛らわしい)",
    },
  },
  create(context) {
    const allowFileDirective = context.options[0]?.allowFileDirective === true;
    return {
      Program(node) {
        const prologue = prologueOf(node.body);
        for (const statement of node.body) {
          if (!isUseServerStatement(statement)) continue;
          if (!prologue.has(statement)) context.report({ node: statement, messageId: "stray" });
          else if (!allowFileDirective) context.report({ node: statement, messageId: "file" });
        }
      },
      ExpressionStatement(node) {
        if (!isUseServerStatement(node) || node.parent?.type === "Program") return;
        context.report({ node, messageId: "inline" });
      },
    };
  },
};
