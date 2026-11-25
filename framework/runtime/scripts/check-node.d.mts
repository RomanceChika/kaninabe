/**
 * `check-node.mjs` の型(本体はどの版の Node でも動くよう素の JavaScript で書く。型はテストが読むためだけにある)。
 */

/**
 * 手元の検査の判定(メジャー版の一致)。
 *
 * @param version - 実行中の版
 * @param nvmrc - `.nvmrc` の中身
 * @returns 止める 1 行(通すなら null)
 */
export function exactVerdict(version: string, nvmrc: string): string | null;

/**
 * ビルドの入口の判定(`engines.node` が許す版か)。
 *
 * @param version - 実行中の版
 * @param engines - 呼び手の `package.json` の `engines.node`
 * @returns 止める 1 行(通すなら null)
 */
export function enginesVerdict(version: string, engines: unknown): string | null;
