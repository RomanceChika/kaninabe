/**
 * 300 行を超えるファイルは、**自分の冒頭の JSDoc に 2 つの宣言**を持つこと（`max-lines` の置き換え）。
 *
 * 300 行は信号であって上限ではない（裁定 2026-09-30）。必要があるなら長いファイルは問題ないが、
 * 何も意識しないと巨大な無駄なファイルもできるので、超えるなら次の 2 つを書く。
 *
 * - `@oversize` … 1 つの責務のまま超える妥当な理由
 * - `@split-review` … 責務で割れるかを検討した結果（割る案と、採らなかった理由）
 *
 * どちらも本文が 10 文字以上であること。**行数そのものを理由に書いたら違反**（行数は理由に
 * ならない）。**300 行以下のファイルに宣言が残っていても違反**（腐った宣言を残さない）。
 * 宣言の無い超過は従来の `max-lines` と同じく違反である。行の数え方は `max-lines` と同じ
 * （空行もコメントも数える）。
 *
 * 判定の本体は `../oversize.mjs` の純関数で、verify の W 群が宣言の本数を数えるのも同じ関数を
 * 呼ぶ。**テストと生成物は従来どおり対象外**（設定側が `off` にする）。
 */

import { judgeOversize, OVERSIZE_MAX_LINES } from "../oversize.mjs";

/** @type {import("eslint").Rule.RuleModule} */
export const declaredOversize = {
  meta: {
    type: "problem",
    docs: {
      description:
        "300 行を超えるファイルは、冒頭の JSDoc に @oversize と @split-review の宣言を持つ(行数は理由にならない)",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      problem: "{{message}}",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? OVERSIZE_MAX_LINES;
    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const judged = judgeOversize(sourceCode.getText(), max);
        for (const problem of judged.problems) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "problem",
            data: { message: problem.message },
          });
        }
      },
    };
  },
};
