/**
 * RLS の migration に出す**ログインセッションの生死の制限ポリシー**の文(表ごとに 1 本)。
 *
 * 許可ポリシー(`rls-migration.ts` が `reads` から出す)とは別の関門である。署名として有効なトークンは、ログアウト・強制終了で
 * セッションが終わった後も期限まで残るので、「実行者の行がある」を許可ポリシーが見ていても、トークンの寿命の間は通ってしまう。
 * 制限ポリシーは許可ポリシーの数・述語に依らず全てと論理積になるため、ロールや述語を足しても閉じたままである。
 * 判定の関数は土台が作る(`api-base.ts`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { RLS_WORDS } from '../messages/messages-rls.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { sessionPolicyName } from '../world/index.js';
import { SESSION_ALIVE_FUNCTION } from './api-base.js';
import { exposed } from './platform-sql.js';

/**
 * ログインセッションの生死を要求する**制限ポリシー**(表ごとに 1 本。全ての許可ポリシーと論理積になる)。
 *
 * 対象はログイン済みの役割だけで、未ログインのロールには効かない(公開の行は誰が見てもよい)。
 * `(select …)` で包むのは、判定を行ごとではなく文ごとに 1 回だけ評価させるため(Supabase の RLS の作法。
 * 実行者の式と同じ手)。判定の関数は土台が作る(`lib/sql/api-base.ts`)。
 *
 * @param table 対象の物理テーブル名
 * @param platform プラットフォームの設定(スキーマ名・ロール名)
 * @returns SQL の行(由来のコメント + 置き換え + 作成)
 */
export function sessionAliveStatement(table: string, platform: PlatformProfile): readonly string[] {
  const name = sessionPolicyName(table);
  return [
    '',
    ...RLS_WORDS.sessionAliveNote.map((line) => `-- ${line}`),
    `-- ${RLS_WORDS.replacePolicy}`,
    `drop policy if exists ${name} on public.${table};`,
    `create policy ${name} on public.${table}`,
    '    as restrictive',
    `    for select to ${platform.roles.authenticated_default}`,
    `    using ((select ${exposed(platform, SESSION_ALIVE_FUNCTION)}()));`,
  ];
}

