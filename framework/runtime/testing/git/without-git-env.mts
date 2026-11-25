/**
 * **子に渡す環境から `GIT_` を外す、ただ 1 つの持ち主**(点検 23 回目 C23-1 / O23-1。11-07 の事故の再発の止めの作り直し)。
 *
 * git は「いま居るリポジトリ」を環境変数でも決める(`GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` / `GIT_OBJECT_DIRECTORY` …)。
 * pre-commit などのフックの中では git がこれらを export するので、親の環境を継いだ子の git(使い捨てのつもりの `git init` / `commit` /
 * `checkout -b` / `config`)が**本物のリポジトリに当たる**。外す変数は表に依らず `GIT_` で始まるものの全部である(表の外の新しい変数も継がない)。
 *
 * 呼び手は 3 つで、どれもここを呼ぶだけ(写しを持たない):
 * - vitest の全部の設定の setupFiles の先頭(`setup-without-git-env.mts`)が、テストのワーカーの `process.env` から消す(実行時の止め。
 *   子は `process.env` を継ぐので、起こし方の綴りに依らず全部の子に効く)。
 * - pre-commit の段を包む道具(開発用リポジトリの道具の木。配布の木には無い)が、段の子に渡す環境から外す(vitest の外の道具も守る二重の守り)。
 * - テストが git を起こす隔離の口(`legacy/spec-tools/__tests__/helpers/git-env.ts`)が、置き場に向けた環境を作る土台にする。
 *
 * 置き場が実行時パッケージのテストの基盤(`testing/`)なのは、製品・仕組み側パッケージ・道具の木・配布される検証器の木の
 * **全部の vitest の設定が同じ 1 本を名指せる**唯一の場所だから(配布される検証器の木は開発用リポジトリだけの道具の木を import できず、
 * 製品の木は検証器の木を import できない。実行時パッケージは全部の木が依存として読む)。依存は持たない(道具が素の node から読むため)。
 */

/** 外す変数の頭。 */
export const GIT_ENV_PREFIX = 'GIT_';

/**
 * 環境の `GIT_` で始まる変数の名前。
 *
 * @param base 元の環境(既定は `process.env`)
 * @returns 名前の並び
 */
export function inheritedGitKeys(base: NodeJS.ProcessEnv = process.env): readonly string[] {
  return Object.keys(base).filter((key) => key.startsWith(GIT_ENV_PREFIX));
}

/**
 * 環境から `GIT_` で始まる変数を全部外した写し(元は変えない。子の `env` にそのまま渡せる)。
 *
 * @param base 元の環境(既定は `process.env`)
 * @returns 写し
 */
export function withoutGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) if (!key.startsWith(GIT_ENV_PREFIX)) copy[key] = value;
  // 製品の型が `NODE_ENV` を要る欄に広げていても、元の環境の写しなので同じ形(元に `NODE_ENV` があれば写しにもある)。
  return copy as NodeJS.ProcessEnv;
}

/**
 * 環境そのものから `GIT_` で始まる変数を消す(setupFiles が `process.env` に使う)。
 *
 * @param env 消す環境(既定は `process.env`)
 * @returns 消した名前
 */
export function dropGitEnv(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const dropped = inheritedGitKeys(env);
  for (const key of dropped) Reflect.deleteProperty(env, key);
  return dropped;
}
