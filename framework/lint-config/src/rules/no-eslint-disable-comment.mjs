/**
 * `eslint-disable` 系コメントの禁止（免除の一本化。決定性の格上げ ⑥ 第2段）。
 *
 * 免除はコードに書かず、仕様側（action_spec / query_spec の `exceptions:`）に理由つきで
 * 宣言する（naming-and-placement.md「免除の一本化」）。コード内に `eslint-disable` /
 * `eslint-disable-line` / `eslint-disable-next-line` / `eslint-enable` を書けると、
 * 免除の入口が仕様側の宣言とコード内コメントの 2 か所に増え、`lint-exceptions.json` を見ても
 * 「実際にはどこまで免除されているか」が分からなくなる。
 *
 * `@ts-expect-error` は対象外（型検査用の別ディレクティブであり、ESLint の免除ではない）。
 */

/** 禁止するディレクティブの接頭辞(いずれも ESLint 公式のコメントディレクティブ)。 */
const BANNED_PREFIXES = [
  'eslint-disable-next-line',
  'eslint-disable-line',
  'eslint-disable',
  'eslint-enable',
];

/** コメント本文(先頭の空白を除く)が禁止ディレクティブで始まるか。 */
function isBannedDirective(text) {
  const trimmed = text.trimStart();
  return BANNED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** @type {import("eslint").Rule.RuleModule} */
export const noEslintDisableComment = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'eslint-disable 系コメントを禁止する。免除は仕様側の exceptions: に理由つきで宣言する',
    },
    schema: [],
    messages: {
      banned:
        'eslint-disable 系コメントはコードに書けない（免除の一本化）。この違反を受け入れるなら、対応する action_spec / query_spec に "exceptions: [{ rule, reason }]" を書いて generate し、app/eslint.config.mjs が読む lint-exceptions.json 経由でファイル単位の免除にすること（naming-and-placement.md「免除の一本化」）。',
    },
  },
  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        for (const comment of sourceCode.getAllComments()) {
          if (isBannedDirective(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'banned' });
          }
        }
      },
    };
  },
};
