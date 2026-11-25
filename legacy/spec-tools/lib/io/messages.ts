/**
 * リポジトリルートを決める口(`requireRepoRoot` と CLI の `--root`)が人に見せる文言。
 *
 * 文言は 1 か所に置く(`lib/diff/messages.ts` と同じ流儀)。**語は台帳(`docs/specs/terms.md`)の綴り**で、
 * 製品の語は 1 語も書かない。io 層は他の層を import しないので、この表も何も import しない。
 */

/** `--root` の綴り(全 CLI で同じ)。 */
export const ROOT_OPTION = '--root';

/**
 * `--root` の説明(**全 CLI の説明はこの 1 本から出る**。各 CLI のヘッダコメントには書き写さず、
 * 「`--root` の説明は `ROOT_OPTION_HELP`」と指すだけにする。人に見えるのは下の文言の末尾)。
 */
export const ROOT_OPTION_HELP = `${ROOT_OPTION} <path>  製品の根(product.md のあるディレクトリ。\`${ROOT_OPTION}=<path>\` の形も可)。省略すると呼ばれた場所(npm の起動場所の \`INIT_CWD\`。無ければ作業ディレクトリ)から上へ探す。相対パスもそこから解く`;

/** リポジトリルートを決めるときの文言(どれも末尾に `--root` の説明を添える)。 */
export const ROOT_MESSAGES = {
  /** 呼ばれた場所から上へ探しても宣言が無かった。 */
  notFound: (from: string, declFile: string): string =>
    `呼ばれた場所 \`${from}\` から上に ${declFile} が見つかりません。` +
    `製品の木の中で実行するか ${ROOT_OPTION} で指定してください\n  ${ROOT_OPTION_HELP}`,
  /** `--root` で指した場所に宣言が無かった。 */
  noDeclarationAt: (root: string, declFile: string): string =>
    `${ROOT_OPTION} で指した \`${root}\` に ${declFile} がありません。` +
    `製品の根(宣言のあるディレクトリ)を指定してください\n  ${ROOT_OPTION_HELP}`,
  /** `--root` に値が無かった。 */
  missingValue: `${ROOT_OPTION} には値(製品の根のパス)が要ります\n  ${ROOT_OPTION_HELP}`,
} as const;
