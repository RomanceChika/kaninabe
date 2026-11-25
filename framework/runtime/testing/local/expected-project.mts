/**
 * 設定の `project_id` が、使い捨ての stack の道具の期待どおりかの照らし(この仕組みの持ち主。点検 20 回目 C20-1)。
 *
 * 呼ぶのは DB を作り直す・変える CLI の前の 3 か所 —— 統合の globalSetup の `db reset`・統合と E2E の `ensureLocalSupabase` /
 * `applyMigrations`([local-supabase.mts](./local-supabase.mts))・題材の通し実行(samples:db)の `db reset`。期待の値を渡すのは開発用リポジトリの
 * 使い捨ての stack の道具(定数はここから読む)。依存は `node:` の標準だけ(道具が素の node から読むため)。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 使い捨ての stack で命令を回す道具(開発用リポジトリだけにある。配布の木には無い)が、命令に渡す**期待する project_id**。
 *
 * 道具は止められると、命令の群が消えたのを確かめてから使い捨ての stack を落とし、設定を共用に戻す(点検 20 回目 C20-1)。それでも
 * 群が消えない・道具が KILL で落ちるなどで設定が先に戻ると、走り続けた命令の次の `db reset` は**共用の stack を作り直す**。そこで
 * DB を作り直す・変える CLI の前に、設定の `project_id` がこの値と同じかを見て、違えば止める(fail-closed)。値が無ければ見ない
 * (共用の stack で回す普通の実行)。照らしの本体はここだけ(統合の globalSetup・E2E・samples:db が呼ぶ)。
 */
export const EXPECT_PROJECT_ENV = 'ST_EXPECT_PROJECT_ID';

/**
 * 設定の `project_id` の行の形(行頭から。区切りの空白はタブも含む。1 = 値の前・2 = 値・3 = 値の後)。`project_id` の行の読みは
 * ここ 1 か所だけ(点検 22 回目 O22-5。以前は使い捨ての設定の書き換え・pre-commit の grep(空白だけでタブを見ない)も別に持っていた)。
 */
export const PROJECT_ID_LINE = /^(project_id\s*=\s*)"([^"]*)"(\s*(?:#.*)?)$/;

/**
 * 設定の本文の `project_id` の行の値の全部(出た順)。
 *
 * @param configText - `config.toml` の本文
 * @returns 値の並び
 */
export function projectIdsOf(configText: string): readonly string[] {
  return configText.split('\n').flatMap((line) => {
    const found = PROJECT_ID_LINE.exec(line);
    return found === null ? [] : [found[2] ?? ''];
  });
}

/**
 * 設定の本文の `project_id`(行頭の `project_id = "…"` がちょうど 1 本のときだけ)。
 *
 * @param configText - `config.toml` の本文
 * @returns project_id(読めなければ null)
 */
export function projectIdOf(configText: string): string | null {
  const found = projectIdsOf(configText);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * 設定の `project_id` が期待と違えば、止める 1 行を返す(期待が無い・同じなら null)。
 *
 * @param configText - `config.toml` の本文
 * @param expected - 期待する project_id(既定は環境変数 `ST_EXPECT_PROJECT_ID`)
 * @returns 止める 1 行か null
 */
export function unexpectedProject(configText: string, expected: string | undefined = process.env['ST_EXPECT_PROJECT_ID']): string | null {
  if (expected === undefined || expected === '') return null;
  const actual = projectIdOf(configText);
  if (actual === expected) return null;
  return (
    `Supabase の設定の project_id(${actual ?? '読めない'})が、使い捨ての stack の道具が渡した期待(${EXPECT_PROJECT_ENV}=${expected})と違うので、` +
    'DB を作り直す・変える CLI を回しません(道具が設定を戻した後も命令が走っている。共用の stack を作り直さない)'
  );
}

/**
 * `root` で回す CLI が読む設定(Supabase CLI の決まりで `<root>/supabase/config.toml`。`--workdir` の既定と同じ)の `project_id` が
 * 期待と違えば止める。期待が無ければ何も読まない。
 *
 * @param root - Supabase CLI を実行する場所(`--workdir` に渡す場所)
 * @param expected - 期待する project_id(既定は環境変数 `ST_EXPECT_PROJECT_ID`)
 * @throws 期待と違う・読めないとき
 */
export function refuseUnexpectedProject(root: string, expected: string | undefined = process.env['ST_EXPECT_PROJECT_ID']): void {
  if (expected === undefined || expected === '') return;
  let text = '';
  try {
    text = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  } catch {
    // 読めなければ project_id も読めない(下で止まる)。
  }
  const problem = unexpectedProject(text, expected);
  if (problem !== null) throw new Error(problem);
}
