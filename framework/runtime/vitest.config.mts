import { defineConfig } from "vitest/config";

/**
 * 実行時パッケージのユニットテストの実行方法。
 *
 * **カバレッジの設定はここに無い。** 実行の根はリポジトリルートの `vitest.config.mts`
 * (projects)であり、閾値もそこが 1 か所で持つ —— v8 プロバイダはプロジェクトルートの外の
 * ファイルを測らないので、根を上げないと「テストは走るのに閾値が掛からない」状態になる
 * (ADR-0013)。ここは「このパッケージのテストをどう実行するか」だけを持つ。
 */
export default defineConfig({
  // **自分のソースを実行する**（`exports` の `test` 条件）。パッケージ名で自分を参照している
  // テストが配布物を読むと、カバレッジが `src/**` に戻らず閾値が掛からない（実測 2.81%）。
  resolve: {
    conditions: ["test", "module", "node", "development|production"],
  },
  // vitest の node 環境は SSR 側の解決を通るので、条件は**両方**に置く（片方だけでは効かない）。
  ssr: {
    resolve: {
      conditions: ["test", "module", "node", "development|production"],
    },
  },
  test: {
    // ワーカーの上限(手元の CPU の上限 2 まで。並びの数は環境で変えず、ここに固定する。環境変数 VITEST_MAX_WORKERS は実 DB の設定の直列を壊すので使わない)。
    maxWorkers: 2,
    // 親の GIT_ を消す止めを先頭に置く(pre-commit の GIT_DIR を継いだ子の git が本物のリポジトリに書かない。点検 23 回目 C23-1。本体は @kaninabe/runtime/testing/git/without-git-env)。
    setupFiles: ["@kaninabe/runtime/testing/git/setup-without-git-env"],
    expect: { requireAssertions: true },
    // 検査を並べて回す機械(pre-commit・merge-check)は負荷が高く、既定の 5 秒では中身と無関係に落ちる。上限だけを広げる(見ている中身は弱めない)。個々のテストに上限を書かない。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    name: "runtime",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
