/**
 * 一時ツリーに置く**本物の接続層**(実 DB に当てるときの実体)。
 *
 * `db-tree.ts` がツリーへ置く。行の型はアプリごとに違うので借りず、この最小形を書く ——
 * ポートの適合(`rpcSourceOf` / `rowSourceOf`)も接続層の責務なのでここが持つ(ADR-0013 §3-1)。
 */

import type { PlatformProfile } from '../../../model/product/platform-profile.js';

/**
 * 一時ツリーに置く本物の接続層(RPC は設定の外に出すスキーマに生成される)。
 *
 * @param platform プラットフォームの設定(クライアントが向けるスキーマ)
 * @returns モジュールの行
 */
export function realClient(platform: PlatformProfile): readonly string[] {
  return [
    '/** 通し実行が置く本物の接続層(行の型はアプリごとに違うので借りない)。 */',
    "import { createClient, type SupabaseClient } from '@supabase/supabase-js';",
    "import type { RowSource, RpcSource } from '@kaninabe/adapter-postgrest';",
    "import { retryRollbacks } from '@kaninabe/adapter-postgrest';",
    '',
    '/** この型でクライアントを持ち回る。 */',
    'export type AppSupabaseClient = SupabaseClient;',
    '',
    '/** service role の封印(本物と同じ形)。 */',
    'declare const SERVICE_BRAND: unique symbol;',
    '',
    '/** service role クライアント(RLS をバイパスする)。 */',
    "export type ServiceClient = AppSupabaseClient & { readonly [SERVICE_BRAND]: 'service' };",
    '',
    '/** 環境変数を読む(未設定なら実 DB の前提が崩れているので落とす)。 */',
    'function requireEnv(name: string): string {',
    '  const value = process.env[name];',
    "  if (value === undefined || value === '') throw new Error(`環境変数 ${name} が設定されていません。`);",
    '  return value;',
    '}',
    '',
    '/**',
    ' * service role クライアントを作る。',
    ' *',
    ' * @returns 認可を素通しするクライアント(RPC は api スキーマを向く)',
    ' */',
    'export function createServiceRoleClient(): ServiceClient {',
    "  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {",
    '    auth: { persistSession: false, autoRefreshToken: false },',
    `    db: { schema: '${platform.exposedSchema}' },`,
    '  }) as unknown as ServiceClient;',
    '}',
    '',
    '/** 関数名を実行時に決める口だけを取り出す(製品の接続層が持つポートの適合。ADR-0013)。RPC を呼ぶ道はやり直しの口だけ(点検 27 回目の決め)。 */',
    'export function rpcSourceOf(client: AppSupabaseClient): RpcSource {',
    '  return retryRollbacks(client);',
    '}',
    '',
    '/** 表・行・列を指定して読む口だけを取り出す(同じポートの適合)。 */',
    'export function rowSourceOf(client: AppSupabaseClient): RowSource {',
    '  const source: unknown = client;',
    '  return source as RowSource;',
    '}',
    '',
  ];
}
