import path from 'node:path';
import process from 'node:process';
import { defineConfig } from 'vitest/config';
import { requireRepoRoot } from './lib/io/paths.js';
import { loadProductRoots } from './lib/model/product/loader.js';
import { stackDirPath } from './lib/model/product/paths.js';
import { RESOLVE_SETTINGS } from './vitest.resolve.js';

/**
 * 統合テスト(実 DB)の設定。
 *
 * 検証器・生成器の翻訳が**実 DB の判定**と一致することを実測するテスト(`*.integration.test.ts`。
 * 例: ガード式の SQL 翻訳 ⇔ TS の評価器)だけをここで実行する。通常の `npm test`(`vitest.config.ts` と `vitest.heavy.config.ts`)は
 * DB を使わないので、この木は除外している。実 DB を共有するのでファイル間は並列にしない。
 *
 * 起動と適用済みの保証は実行時パッケージのテスト基盤(`@kaninabe/runtime/testing/local`)が持つ。
 * **ここが渡すのは語だけ**で、どちらも製品の事情ではなく**製品の根の宣言**(`product.md`)から出す:
 *   - `supabaseRoot`: Supabase CLI を実行する場所 = ローカルスタックのディレクトリを子に持つ親。
 *     スタックの場所は migration の置き場の宣言から導く(`stackDirPath`。CLI はスタックのディレクトリ名が
 *     固定なので、実行する場所はその 1 つ上である)。
 *   - `schemaProbeQuery`: 「適用済み」を確かめる問い合わせ。このテストは製品の表を 1 つも使わない
 *     (一時表だけで差分を取る)ので、**表の名前を持たず**、API の入口が応答することだけを見る。
 */
const repoRoot = requireRepoRoot(process.cwd());
const { model } = loadProductRoots(repoRoot);
if (model.roots === null) {
  throw new Error('製品の根の宣言(product.md の roots)を読めません。`npm run verify` で P 群の指摘を確かめてください。');
}

export default defineConfig({
  ...RESOLVE_SETTINGS,
  test: {
    // ワーカーの上限(手元の CPU の上限 2 まで。実 DB の検査は fileParallelism: false で 1 本ずつ。上限も 1 と書いて揃える。環境変数 VITEST_MAX_WORKERS は実 DB の設定の直列を壊すので使わない)。
    maxWorkers: 1,
    expect: { requireAssertions: true },
    environment: 'node',
    include: ['__tests__/**/*.integration.test.ts'],
    root: import.meta.dirname,
    // プロセスの TZ を零オフセットにしない(製品の統合テスト一式と同じ理由・同じ値): 零オフセットでは、
    // 実行環境の壁時計に暗黙依存する書き方の**向きの誤り**が偶然一致して素通りする。
    env: { TZ: 'Pacific/Chatham' },
    globalSetup: ['./__tests__/helpers/dist-fresh-setup.ts', '@kaninabe/runtime/testing/local/global-setup'],
    // 親の GIT_ を消す止めを先頭に置く(pre-commit の GIT_DIR を継いだ子の git が本物のリポジトリに書かない。点検 23 回目 C23-1。本体は @kaninabe/runtime/testing/git/without-git-env)。
    setupFiles: ['@kaninabe/runtime/testing/git/setup-without-git-env', '@kaninabe/runtime/testing/local/setup-env', './__tests__/helpers/fast-check-seed.ts'],
    provide: {
      schemaProbeQuery: '?limit=1',
      supabaseRoot: path.dirname(path.join(repoRoot, stackDirPath(model.roots))),
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 300_000,
  },
});
