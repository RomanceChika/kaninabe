/**
 * 題材の生成テストを**実 DB に当てる**ための一時ツリーの仕上げ。
 *
 * ## 何を差し替えるのか
 *
 * 型検査のためのツリー(`__tests__/samples/harness.ts`)は、「そのアプリの DB に触る手足」を
 * 最小の stub で置いている —— 型が付けば足りるからである。実 DB に当てるには、その 3 つだけを
 * **本物**に差し替える必要がある。
 *
 * | 差し替えるもの | なぜ stub では足りないか |
 * |---|---|
 * | 接続層(`supabase/client.ts`) | 実際に接続する。RPC は `api` スキーマに生成されるので、そこを向く |
 * | シード(`__tests__/seed.ts`) | 認証ユーザを作り、行を消し、pg に直結する —— どれも実 DB の操作である |
 * | セッション属性(`supabase/session.ts`) | 実行者の行の `session: true` の欄を JWT へ写す(読みは pg 直結)。境界(`filters`)の判定はその枝を読むので、no-op の stub では緑にならない |
 * | 行の型(`supabase/database.types.ts`) | 型検査には最小形で足りるが、実行時は形を要求されない(ここは stub のままでよい) |
 *
 * **題材ごとの特別扱いは 1 つも無い。** シードが空にする表の並びは生成された表の DDL の
 * ファイル名から来る(`_ddl_{表}.sql`)し、実行者の表は生成物(`SESSION_ACTOR_TABLE`)が
 * 宣言するので、題材の語彙はこのファイルに 1 語も無い。
 *
 * ## 何を実行するのか
 *
 * **一致の証明と RLS の挙動テストの両方**である。RLS の挙動テストは画面と同じ経路
 * (`api` スキーマのビュー)で読むが、そのビューは表ごとの `surface_migration` から
 * 生成されるようになった(束「api の仕様書 + api ビューの生成」)ので、題材の一時 workdir にも
 * surface が立つ。
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { realSession } from './db-tree-session.js';
import type { PlatformProfile } from '../../../model/product/platform-profile.js';
import { generatedModuleOf } from '../../../model/product/layout.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import { appPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { SERVER_ONLY_STUB, writeServerOnlyStub } from './server-only-stub.js';
import { REQUIRE_ASSERTIONS_LINE, sampleBaseDir, sampleInfrastructureTests } from './db-places.js';
import { realClient } from './db-tree-client.js';
import { EQUIVALENCE_TEST_ROLES, RLS_TEST_ROLES, generatedTestIncludes } from './db-test-places.js';


/**
 * 一時ツリーに置く本物のシード。
 *
 * 表の並びだけが題材ごとに変わるので、そこを差し込んで組む。
 *
 * @param tables 空にする表(依存の逆順 = 参照する側が先)
 * @param platform プラットフォームの設定(RLS が効くクライアントが向けるスキーマ)
 * @returns モジュールの行
 */
function realSeed(tables: readonly string[], platform: PlatformProfile): readonly string[] {
  return [
    '/** 通し実行が置く本物のシード(実 DB に触る手足)。表の並びは生成された表の DDL から来る。 */',
    "import { randomUUID } from 'node:crypto';",
    "import { Client as PgClient } from 'pg';",
    "import { createClient } from '@supabase/supabase-js';",
    "import type { AppSupabaseClient } from '../supabase/client';",
    '',
    '/** 作った認証ユーザ。 */',
    'export interface SeededMember {',
    '  readonly id: string;',
    '  readonly email: string;',
    '  readonly password: string;',
    '}',
    '',
    '/** テスト用ユーザに共通のパスワード(ローカル専用)。 */',
    "const TEST_PASSWORD = 'test-password-1234';",
    '',
    '/** この題材の表の全数(空にする順。参照する側が先)。 */',
    `const TABLES: readonly string[] = ${JSON.stringify(tables)};`,
    '',
    '/** 環境変数を読む(未設定なら実 DB の前提が崩れているので落とす)。 */',
    'function requireEnv(name: string): string {',
    '  const value = process.env[name];',
    "  if (value === undefined || value === '') throw new Error(`環境変数 ${name} が設定されていません。`);",
    '  return value;',
    '}',
    '',
    '/**',
    ' * RLS が効くクライアントを作る。',
    ' *',
    ' * @param accessToken 実行者のアクセストークン(省略で未ログイン)',
    ' * @returns RLS が適用されるクライアント',
    ' */',
    'export function createRlsClient(accessToken?: string): AppSupabaseClient {',
    '  const headers = accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` };',
    "  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {",
    '    auth: { persistSession: false, autoRefreshToken: false },',
    '    global: { headers },',
    `    db: { schema: '${platform.exposedSchema}' },`,
    '  }) as unknown as AppSupabaseClient;',
    '}',
    '',
    '/**',
    ' * ドメインの表と認証ユーザを空にする。',
    ' *',
    ' * @param client service role クライアント',
    ' */',
    'export async function resetDatabase(client: AppSupabaseClient): Promise<void> {',
    '  // 1 文で消す —— 参照し合う表(循環)を逐次 DELETE では組めない。追記専用の台帳も',
    '  // TRUNCATE は行トリガを発火しないので、執行を弱めずに空にできる。',
    '  await withPg(async (pg) => {',
    '    await pg.query(`truncate table ${TABLES.map((table) => `public.${table}`).join(\', \')}`);',
    '  });',
    '  const { data, error } = await client.auth.admin.listUsers({ perPage: 200 });',
    '  if (error !== null) throw new Error(`認証ユーザの一覧取得に失敗しました: ${error.message}`);',
    '  for (const user of data.users) await client.auth.admin.deleteUser(user.id);',
    '}',
    '',
    '/**',
    ' * 認証ユーザだけを作る。',
    ' *',
    ' * @param client service role クライアント',
    ' * @returns 作られた認証ユーザ',
    ' */',
    'export async function seedAuthUser(client: AppSupabaseClient): Promise<SeededMember> {',
    '  const email = `${randomUUID()}@example.test`;',
    '  const created = await client.auth.admin.createUser({',
    '    email,',
    '    password: TEST_PASSWORD,',
    '    email_confirm: true,',
    '  });',
    '  if (created.error !== null || created.data.user === null) {',
    "    throw new Error(`認証ユーザの作成に失敗しました: ${created.error?.message ?? 'user is null'}`);",
    '  }',
    '  return { id: created.data.user.id, email, password: TEST_PASSWORD };',
    '}',
    '',
    '/**',
    ' * ログインしてアクセストークンを得る。',
    ' *',
    ' * @param member 認証ユーザ',
    ' * @returns アクセストークン',
    ' */',
    'export async function signIn(member: SeededMember): Promise<string> {',
    '  const client = createRlsClient();',
    '  const { data, error } = await client.auth.signInWithPassword({',
    '    email: member.email,',
    '    password: member.password,',
    '  });',
    '  if (error !== null || data.session === null) {',
    "    throw new Error(`ログインに失敗しました: ${error?.message ?? 'session is null'}`);",
    '  }',
    '  return data.session.access_token;',
    '}',
    '',
    '/**',
    ' * ローカル DB へ pg 直結して 1 つの処理を実行する。',
    ' *',
    ' * @param run 接続を受け取る処理',
    ' * @returns run の戻り値',
    ' */',
    'export async function withPg<T>(run: (pg: PgClient) => Promise<T>): Promise<T> {',
    '  const pg = await connectPg();',
    '  try {',
    '    return await run(pg);',
    '  } finally {',
    '    await pg.end();',
    '  }',
    '}',
    '',
    '/**',
    ' * ローカル DB へ pg 直結した接続を 1 本開く(閉じるのは呼び側)。',
    ' *',
    ' * @returns 接続済みクライアント',
    ' */',
    'export async function connectPg(): Promise<PgClient> {',
    "  const pg = new PgClient({ connectionString: requireEnv('SUPABASE_DB_URL') });",
    '  await pg.connect();',
    '  return pg;',
    '}',
    '',
  ];
}


/**
 * 生成テストを実行する vitest の設定(一時ツリーの `app/` を root にする)。
 *
 * @param layout 置き場の配置(`include` は実 DB で実行する 3 種の役割の置き場から引く。拾う側 `generatedTestFiles` と同じ口)
 */
export function vitestConfig(layout: ProductLayout): readonly string[] {
  return [
    "import { fileURLToPath } from 'node:url';",
    "import { defineConfig } from 'vitest/config';",
    '',
    '/**',
    ' * 題材の生成テストを実 DB に当てる設定(通し実行が書き出す)。',
    ' *',
    ' * 対象は**一致の証明と RLS の挙動テスト**の両方である —— 面のビューは表ごとの',
    ' * surface_migration から生成されるので、題材の一時 workdir にも画面と同じ読み取り経路が立つ。',
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
    // (実体は通し実行が置く。SERVER_ONLY_STUB の docstring に理由がある)。
    `      'server-only': fileURLToPath(new URL('./${SERVER_ONLY_STUB}', import.meta.url)),`,
    '    },',
    '  },',
    '  test: {',
    REQUIRE_ASSERTIONS_LINE,
    "    environment: 'node',",
    '    include: [',
    ...generatedTestIncludes(layout, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES]).map((glob) => `      '${glob}',`),
    '    ],',
    "    exclude: ['**/node_modules/**'],",
    '    fileParallelism: false,',
    '    testTimeout: 600_000,',
    '    hookTimeout: 600_000,',
    '  },',
    '});',
    '',
  ];
}

/** 一時ツリーの中で、実 DB に当てるために書き換えた / 足したファイル。 */
/**
 * 一時ツリーの中の実装の木(その題材が宣言した位置)。
 *
 * 通し実行は生成された TS を**本物のエンジンにつないで型検査する**ので、実装の木の位置が
 * 決まっていることが前提である。宣言が無ければ型検査の段取りそのものが組めない ——
 * **通し実行は設計に無い経路を作らない**ので、既定値に倒さず止める(`?? ''` を流すと
 * 一時ツリーの外を指す。scripts-code-quality.md §根は製品が宣言する)。
 *
 * @param roots その題材が宣言した根
 * @returns 実装の木(リポジトリルート相対)
 */
export function sampleAppRoot(roots: ProductRoots): string {
  const app = appPath(roots);
  if (app === null) throw new Error('fixture の宣言に app が無いため、生成物の型検査を組めません');
  return app;
}

export interface RealHarness {
  /** vitest の設定(一時ツリーの絶対パス)。 */
  readonly configFile: string;
  /** vitest の root(一時ツリーの `app/`)。 */
  readonly root: string;
}

/**
 * 一時ツリーの「実 DB に触る手足」を本物に差し替え、vitest の設定を置く。
 *
 * @param args 一時ツリーのルートと、空にする表の並びと、プラットフォームの設定・置き場の配置(呼び側が選ぶ)
 * @returns vitest に渡す設定と root
 */
export function writeRealHarness(args: {
  readonly root: string;
  readonly tables: readonly string[];
  readonly roots: ProductRoots;
  readonly platform: PlatformProfile;
  readonly layout: ProductLayout;
}): RealHarness {
  const app = path.join(args.root, sampleAppRoot(args.roots));
  // 基盤の層の接続層(`supabase`)とテスト支援の土台は、置き場の配置が決める(製品の根からの相対に直して一時ツリーの実装の木へ書く)。
  const within = (place: string): string => path.join(args.root, place);
  const connection = sampleBaseDir(args.roots, args.layout, { layer: 'infrastructure', dir: 'supabase' });
  writeFileSync(within(`${connection}/client.ts`), realClient(args.platform).join('\n'));
  writeFileSync(within(`${sampleInfrastructureTests(args.roots, args.layout)}/seed.ts`), realSeed(args.tables, args.platform).join('\n'));
  const sessionProfileModule = generatedModuleOf(args.layout, args.roots, 'session-profile');
  if (sessionProfileModule === null) throw new Error('置き場の配置と製品の roots.generated から生成物のモジュールの指定を引けないため、通し実行の一時ツリーを組めません');
  writeFileSync(within(`${connection}/session.ts`), realSession(args.platform, sessionProfileModule).join('\n'));
  writeServerOnlyStub(app);
  const configFile = path.join(app, 'vitest.samples.mts');
  writeFileSync(configFile, vitestConfig(args.layout).join('\n'));
  return { configFile, root: app };
}
