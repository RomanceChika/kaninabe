/**
 * **Supabase のプラットフォーム設定**(`PlatformProfile` の値)。
 *
 * Supabase が決める約束 —— DB ロールの名前(PostgREST が使う 3 つ)・現在の実行者を返す認証関数・
 * セッション属性が載る JWT の枝・外に出すスキーマの名前 —— は、ここ 1 か所だけが綴りを持つ。
 * SQL の生成器はこの値を**引数で受け取る**(型は `lib/model/product/platform-profile.ts`)。値を選んで渡すのは
 * 組み立ての根(CLI・通し実行)だけである。
 *
 * 純粋な値であり、何も import しない(型だけ)。**アプリの語彙は 1 語も持たない。**
 */

import type { PlatformProfile } from '../../model/product/platform-profile.js';

/** Supabase(PostgREST + Supabase Auth)の約束。 */
export const SUPABASE_PLATFORM_PROFILE: PlatformProfile = {
  roles: {
    anonymous: 'anon',
    authenticated_default: 'authenticated',
    system: 'service_role',
  },
  currentActorExpr: 'auth.uid()',
  // アクセストークンは `session_id`(= auth.sessions.id)を運ぶ。サインアウト・強制終了はその行を消すので、
  // トークンが署名として有効なままでも「行が無い」で偽になる。識別子の無いトークンは null と比べて偽(欠けたら閉じる)。
  // `not_after` は認証基盤が持つセッションの打ち切り時刻(設定の timebox)で、過ぎたセッションも偽にする。
  sessionAliveExpr:
    "exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and (s.not_after is null or s.not_after > now()))",
  sessionClaimsPath: ['app_metadata', 'profile'],
  exposedSchema: 'api',
  // PostgREST は SQL の公開面をそのまま API として出す(スキーマの GRANT がそのまま API の権限になる)。
  surfaceExposure: { kind: 'sql-is-api' },
  // 関数を作る役。migration は `postgres`(CLI の `db push` / `migration up` の接続)が流すので、既定を閉じる責務は
  // migration が持つ(実在するのにメンバーでなければ止まる)。`supabase_admin` はプラットフォームが拡張や内部の
  // 関数を作る役で、`postgres` と同じ構えの既定の付与を持つが、migration の接続はそのメンバーではなく書き換えられない。
  functionCreators: [
    { role: 'postgres', handling: 'migration' },
    {
      role: 'supabase_admin',
      handling: 'external',
      reason:
        'プラットフォームが拡張や内部の関数を作る役。migration を流す接続(postgres)はこの役のメンバーではなく、既定の付与を書き換えられない。',
    },
  ],
  // ログインセッションは Supabase Auth が発行する JWT。署名の方式(対称 / 非対称)はプロジェクトの鍵の設定が決めるもので、
  // リポジトリの宣言に無く、検査から見えない(方式をここで発明しない)。
  sessionToken: {
    format: 'JWT',
    issuer: 'Supabase Auth',
    algorithm: 'Supabase のプロジェクトの JWT 署名鍵の設定が決める(リポジトリの宣言に方式は無く、検査から見えない)',
    scope: 'ログインセッション(cookie)。PostgREST と Supabase Auth に提示する。セッションの寿命と更新トークンの回転は H5 が設定を見る',
  },
};
