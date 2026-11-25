/**
 * 構造の突合を一時ツリーへ**写して**、それだけを実行する vitest の設定を置く口。
 *
 * `db-parity.ts` が呼ぶ「一時ツリーの仕上げ」の 1 つである(`db-tree.ts` と同じ束)。
 *
 * ## symlink ではなく写す
 *
 * `db-tree.ts` の RLS ハーネスと同じ理由である —— Node も vite も既定で symlink の実体
 * (realpath)を基準に相対 import を解くので、symlink にすると突合の `../seed` が**ホストの**
 * シードを指し、一時ツリーの外へ出る。写せば木の中で閉じる。
 *
 * ## 何も足さない
 *
 * ここが書くのは vitest の設定 1 枚だけであり、**テストは 1 行も書かない**。通し実行が自分で
 * 表明を書くと「緑」がそのぶんだけ通し実行の気持ちになるからである(③-2 の裁定 (B) と同じ
 * 線引き —— 通し実行は設計に無い経路を発明しない)。
 */

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sampleAppRoot } from './db-tree.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { SERVER_ONLY_STUB, writeServerOnlyStub } from './server-only-stub.js';
import { REQUIRE_ASSERTIONS_LINE } from './db-places.js';

/** 一時ツリーの中で、構造の突合を実行するために置いたもの。 */
export interface ParityHarness {
  /** vitest の設定(一時ツリーの絶対パス)。 */
  readonly configFile: string;
  /** vitest の root(一時ツリーの `app/`)。 */
  readonly root: string;
}

/**
 * 名指しのファイルだけを実行する vitest の設定(構造の突合と、生成した試験の実行 `wiring-tests.ts` が使う)。
 *
 * `include` は**実行すると決めたファイルの列挙**であり、免除リストの裏返しではない ——
 * この列挙は `db-parity.ts` の判定・生成物の一覧が実行のたびに作る(ここは受け取って書くだけ)。
 *
 * @param includes `app/` から見た相対パス(実行するテスト)
 * @returns 設定ファイルの行
 */
export function includeVitestConfig(includes: readonly string[]): readonly string[] {
  return [
    "import { fileURLToPath } from 'node:url';",
    "import { defineConfig } from 'vitest/config';",
    '',
    '/**',
    ' * 題材の名指しの試験を実行する設定(通し実行が書き出す)。',
    ' *',
    ' * 実行する本数は題材の宣言・生成物から導かれるので、ここには固定の一覧が無い。',
    ' */',
    'export default defineConfig({',
    // **テストはソースを実行する**(`@kaninabe/runtime` の `exports` の `test` 条件。ADR-0013 の
    // 配り方 A)。配布物(CommonJS)の `require('server-only')` は下の alias を通らないので、
    // 条件を指定しないとマーカーが本物のまま届いて落ちる(実測)。node 環境は SSR 側の解決を
    // 通るので、条件は `ssr.resolve` にも置く。
    '  ssr: {',
    '    resolve: {',
    "      conditions: ['test', 'module', 'node', 'development|production'],",
    '    },',
    '  },',
    '  resolve: {',
    "    conditions: ['test', 'module', 'node', 'development|production'],",
    '    alias: {',
    "      '@': fileURLToPath(new URL('./src', import.meta.url)),",
    // サーバー専用マーカーは Node では例外を投げるので、テストでは空の実体に差し替える
    // (実体は通し実行が置く。`db-tree.ts` の SERVER_ONLY_STUB が名前と理由を持つ)。
    `      'server-only': fileURLToPath(new URL('./${SERVER_ONLY_STUB}', import.meta.url)),`,
    '    },',
    '  },',
    '  test: {',
    REQUIRE_ASSERTIONS_LINE,
    "    environment: 'node',",
    `    include: ${JSON.stringify(includes)},`,
    "    exclude: ['**/node_modules/**'],",
    '    fileParallelism: false,',
    '    testTimeout: 600_000,',
    '    hookTimeout: 600_000,',
    '  },',
    '});',
    '',
  ];
}

/** 1 ファイルを一時ツリーの同じ位置へ写す(置いた先の絶対パスを返す)。 */
function place(root: string, repoRoot: string, file: string): string {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(repoRoot, file), target);
  return target;
}

/**
 * 実行すると決めた構造の突合を一時ツリーへ写し、それだけを実行する設定を置く。
 *
 * @param args 一時ツリーのルート・リポジトリルート・実行するテストと持ち込む部品(リポジトリルート相対)
 * @returns vitest に渡す設定と root
 */
export function writeParityHarness(args: {
  readonly root: string;
  readonly repoRoot: string;
  readonly files: readonly string[];
  readonly carried?: readonly string[];
  readonly roots: ProductRoots;
}): ParityHarness {
  const app = path.join(args.root, sampleAppRoot(args.roots));
  const includes: string[] = [];
  // 部品を先に置く(テストが import する先が在ってから実行する)。どちらも写すだけである。
  for (const file of args.carried ?? []) place(args.root, args.repoRoot, file);
  for (const file of args.files) {
    includes.push(path.relative(app, place(args.root, args.repoRoot, file)));
  }
  writeServerOnlyStub(app);
  const configFile = path.join(app, 'vitest.samples-parity.mts');
  writeFileSync(configFile, includeVitestConfig(includes).join('\n'));
  return { configFile, root: app };
}
