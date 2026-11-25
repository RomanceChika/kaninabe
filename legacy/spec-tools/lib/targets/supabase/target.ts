/**
 * **プラットフォームの後段 Supabase**(`role: platform`)。プラットフォームの設定と、Supabase の設定・拡張(config.toml・pg_cron)に属する検査を持つ。
 *
 *   - プラットフォームの設定 … DB ロールの名前・現在の実行者の式・セッション属性の枝・外に出すスキーマ名(`platform-profile.ts`)。
 *     SQL を書く側がこれを引数で受け取る
 *   - H5 … ローカル設定 `config.toml` のサインインの方式・外へ出すスキーマが、認証フロー仕様の宣言(`providers`)と
 *     プラットフォームの設定(`exposedSchema`)の範囲に収まっていること(`config/h5-auth-config.ts`)
 *   - J3 … カタログの `scheduler: database` の行と、migration の `cron.schedule(...)` の双方向一致(pg_cron は Supabase の拡張なのでここ。
 *     `job/j3-pgcron-parity.ts`)
 *
 * ルール ID(H5・J3)・検査の中身・指摘の文面は、後段へ移す前と同じである(執行者の置き場が動いただけ)。
 * この値を選んで検査と生成器の一覧に合成するのは組み立ての根(`cli/select-targets.ts`)だけで、コアはこの後段の名前を知らない。
 * ほかに、ローカルの Supabase を相手にした通し実行の道具 `samples/` もこの後段の置き場にある(`cli/samples-db.ts` が読む)。
 */

import type { Target } from '../../target-api/contract.js';
import { SUPABASE_AUTH_CONFIG } from './config/h5-auth-config.js';
import { verifyPgCronParity } from './job/j3-pgcron-parity.js';
import { SUPABASE_PLATFORM_PROFILE } from './platform-profile.js';

/** Supabase(プラットフォーム)の後段。 */
export const SUPABASE_TARGET: Target = {
  id: 'supabase',
  role: 'platform',
  verifiers: [{ group: 'job', id: 'J3', verify: verifyPgCronParity }],
  generators: [],
  platform: SUPABASE_PLATFORM_PROFILE,
  authConfig: SUPABASE_AUTH_CONFIG,
};
