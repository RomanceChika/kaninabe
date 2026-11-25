/**
 * 題材の一時ツリーに置く**本物のセッション属性の書き込み口**のソース。
 *
 * `db-tree.ts` がツリーへ置く、「実 DB に触る手足の差し替え」の 1 つである(接続層・シードと
 * 同じ束)。
 *
 * ## surface(`api` のビュー)から読む
 *
 * 実行者の行の読み出しは service role クライアントで `api` のビューを通す —— **アプリの
 * 実装(`app/src/infrastructure/supabase/session.ts`)がそうしているから**であり、ここが
 * pg 直結で読むと「アプリと同じ経路が通ること」が実行の緑から抜け落ちる。
 *
 * 束「api ビュー生成」の時点では通せなかった。**生成 DDL が表の権限を出していなかった**ので、
 * 空の DB では特権ロールが元の表に `select` を持たず(Supabase の既定権限に `select` は無い)、
 * `security_invoker` のビュー越しに読むと 42501 になったからである。束「生成 DDL の表への
 * 権限」で表の DDL が `grant select, insert, update, delete … to service_role` を出すように
 * なり、迂回の理由が無くなった。
 *
 * **隠し列(`fields_hidden`)は問題にならない** —— 生成ビューのマスクは
 * `not api.is_end_user() or {述語}` であり、特権のある接続では無条件に解ける(元々 RLS も
 * バイパスしているので、ここで新しく広がってはいない)。
 *
 * **題材の語彙は 1 語も無い** —— 実行者の表の名前は生成物(`SESSION_ACTOR_TABLE`)が、
 * 載せる欄は `SESSION_FIELDS` が示す。
 */

import type { PlatformProfile } from '../../../model/product/platform-profile.js';

/**
 * セッション属性の枝(外側から辿る鍵の並び)を、変数 `profile` を末端に置く入れ子のオブジェクトリテラルにする
 * (認証 API の管理用更新が、その入れ子のとおりに JWT の枝へ書く)。
 *
 * @param path セッション属性が載る枝の鍵の並び
 * @returns TypeScript のオブジェクトリテラルの字面
 */
function claimsLiteral(path: readonly string[]): string {
  return path.reduceRight<string>((inner, key) => `{ ${key}: ${inner} }`, 'profile');
}

/**
 * 一時ツリーに置く本物のセッション属性の書き込み口。
 *
 * 実行者の表の名前は生成物(`SESSION_ACTOR_TABLE`)が示すので、ここに題材の語は無い。
 * 列が 0 件、または実行者の集約に表が無い題材では何もしない(境界を持たない world である)。
 *
 * @param platform プラットフォームの設定(セッション属性が載る枝 = 認証 API へ書き込む入れ子の鍵)
 * @param sessionProfileModule 生成物のセッション属性のモジュールの import の指定(置き場の配置と製品の根から引いたもの)
 * @returns モジュールの行
 */
export function realSession(platform: PlatformProfile, sessionProfileModule: string): readonly string[] {
  return [
    '/** 通し実行が置く本物のセッション属性の書き込み口(実行者の行の欄を JWT へ写す)。 */',
    `import { SESSION_ACTOR_TABLE, SESSION_FIELDS } from '${sessionProfileModule}';`,
    "import type { ServiceClient } from './client';",
    '',
    '/**',
    ' * 実行者の行から session: true の欄をセッションへ写す。',
    ' *',
    ' * 行の読み出しは**アプリと同じ経路**(service role クライアントで api のビューを読む)で',
    ' * 行う。特権のある接続では隠し列のマスクが無条件に解けるので、宣言した欄はそのまま取れる。',
    ' *',
    ' * @param client service role クライアント(読み出しとセッション属性の書き込みに使う)',
    ' * @param actorId 実行者の id',
    ' */',
    'export async function writeSessionProfile(client: ServiceClient, actorId: string): Promise<void> {',
    '  const fields: readonly string[] = SESSION_FIELDS;',
    '  if (fields.length === 0 || SESSION_ACTOR_TABLE === null) return;',
    '  const { data, error } = await client',
    '    .from(SESSION_ACTOR_TABLE)',
    "    .select(fields.join(','))",
    "    .eq('id', actorId)",
    '    .maybeSingle();',
    '  if (error !== null) throw new Error(`実行者の行の取得に失敗しました: ${error.message}`);',
    '  if (data === null) return;',
    '  const row = data as unknown as Readonly<Record<string, unknown>>;',
    '  const profile = Object.fromEntries(fields.map((name) => [name, row[name]]));',
    `  const updated = await client.auth.admin.updateUserById(actorId, ${claimsLiteral(platform.sessionClaimsPath)});`,
    '  if (updated.error !== null) {',
    '    throw new Error(`セッション属性の書き込みに失敗しました: ${updated.error.message}`);',
    '  }',
    '}',
    '',
  ];
}
