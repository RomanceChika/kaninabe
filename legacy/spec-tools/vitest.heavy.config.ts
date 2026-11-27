import { defineConfig } from 'vitest/config';
import { RESOLVE_SETTINGS } from './vitest.resolve.js';

/**
 * 道具の木のテストの重い組(`npm test` の 2 本目。軽い組 `vitest.config.ts` の後に回す)。子のプロセスを起こすテスト
 * (CLI・tsx・git・docker・本物の `vitepress build`)と、1 本で 1 分を超える計算のテスト(`book-entry-notice`)を集める。
 * 子のプロセスは並びの数の外でコアを使うので、この組の並びは小さく固定する。
 * `include` は軽い組の `exclude` の 3 つ目から後ろと同じ並び(突合は `workflow-scripts.test.ts`)。設定の残りは軽い組と同じ。
 */
export default defineConfig({
  ...RESOLVE_SETTINGS,
  test: {
    expect: { requireAssertions: true },
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // 並びの数は環境で変えず、ここに固定する(点検 16 回目)。手元の CPU の上限で 2 まで(同じ機械で別の作業も動く。環境変数 VITEST_MAX_WORKERS は実 DB の設定の直列を壊すので使わない)。
    maxWorkers: 2,
    include: ['__tests__/dev-repo/unit/formal/formal-scope.test.ts', '__tests__/dev-repo/unit/gates/build-gate-routes.test.ts', '__tests__/dev-repo/unit/gates/ci-changes-shell.test.ts', '__tests__/dev-repo/unit/gates/ledger-commit-gate.test.ts', '__tests__/dev-repo/unit/gates/lint-type-settings.test.ts', '__tests__/dev-repo/unit/gates/main-gate-install.test.ts', '__tests__/dev-repo/unit/gates/main-gate.test.ts', '__tests__/dev-repo/unit/gates/merge-check-runner.test.ts', '__tests__/dev-repo/unit/gates/node-guard.test.ts', '__tests__/dev-repo/unit/gates/output-paths.test.ts', '__tests__/dev-repo/unit/gates/precommit-dist-check.test.ts', '__tests__/dev-repo/unit/gates/precommit-step-limit.test.ts', '__tests__/dev-repo/unit/gates/runner-units.test.ts', '__tests__/dev-repo/unit/gates/scope-parity.test.ts', '__tests__/dev-repo/unit/gates/stage-scope.test.ts', '__tests__/dev-repo/unit/gates/test-scope.test.ts', '__tests__/dev-repo/unit/generate/book-entry-notice.test.ts', '__tests__/dev-repo/unit/model/config/named-cli-path.test.ts', '__tests__/dev-repo/unit/model/config/test-git-guard.test.ts', '__tests__/dev-repo/unit/model/config/test-runner-universe.test.ts', '__tests__/samples/implemented-scope.test.ts', '__tests__/unit/cli/build-gate-scope.test.ts', '__tests__/unit/cli/framework-root-wiring.test.ts', '__tests__/unit/cli/generate-book-check.test.ts', '__tests__/unit/cli/generate-book-guards.test.ts', '__tests__/unit/cli/generate-book-inputs.test.ts', '__tests__/unit/cli/generate-book.test.ts', '__tests__/unit/cli/generate-refusal.test.ts', '__tests__/unit/cli/outside-tool-tree.test.ts', '__tests__/unit/deps/offline.test.ts', '__tests__/unit/diff/diff-io.test.ts', '__tests__/unit/formal/freshness-cli.test.ts', '__tests__/unit/formal/recall-closure.test.ts', '__tests__/unit/gates/migration-diff.test.ts', '__tests__/unit/gates/migration-immutability.test.ts', '__tests__/unit/generate/apply-sections.test.ts', '__tests__/unit/helpers/git-env.test.ts', '__tests__/unit/io/safe-path.test.ts', '__tests__/unit/targets/supabase/samples/docker-alive.test.ts', '__tests__/unit/theme/body-guard.test.ts', '__tests__/unit/theme/docs-dev-server.test.ts', '__tests__/unit/theme/frontmatter-guard.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    root: import.meta.dirname,
    // 仕組み側の配布物が古い・依存の置き場が根の外なら、1 本も回さずに 1 行で止める(点検 19 回目 C19-1 / C19-2)。
    globalSetup: ['./__tests__/helpers/dist-fresh-setup.ts'],
    // 親の GIT_ を消す止めを先頭に置く(pre-commit の GIT_DIR を継いだ子の git が本物のリポジトリに書かない。点検 23 回目 C23-1。本体は @kaninabe/runtime/testing/git/without-git-env)。
    setupFiles: ['@kaninabe/runtime/testing/git/setup-without-git-env', './__tests__/helpers/fast-check-seed.ts'],
  },
});
