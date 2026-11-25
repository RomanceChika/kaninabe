import { acquireDbLock, releaseDbLock, type DbLock } from '../local/db-lock.mjs';
import { applyEnv, applyMigrations, ensureLocalSupabase } from '../local/local-supabase.mjs';
import type { SupabaseRoot } from '../local/local-supabase.mjs';

/**
 * E2E スモークの実 DB ガード。
 *
 * **統合テストと同じ advisory lock を取る**（キーは [db-lock.mts](../local/db-lock.mts)）。
 * 別のキーにすると互いを排除できず、統合テストの `db reset` がスモークの舞台を消したり、
 * スモークの書き込みが統合テストの数え上げに混ざったりする。判断の基準は「その実行が
 * 共有 DB に破壊的な操作をするか」であり、E2E も（固定データの作り直しと、シナリオ自身の
 * 書き込みで）持っている。
 *
 * **ただし `supabase db reset` はしない**。E2E が壊すのは自分の固定データだけで、
 * スキーマは `migration up` で足りる。ロックが `db reset` で一時的に外れる問題
 * （integration.md 3節）はこちら側には無い。
 *
 * ロックは globalSetup で取り、globalTeardown で返す。両者はランナーの同じプロセスで
 * 動くので、保持している接続をこのモジュールの中に置いておける。プロセスごと落ちた場合も
 * ロックはセッションと一緒に解放されるため、取り残されない。
 */

/** 保持しているロック（取得前と解放後は `null`）。 */
let held: DbLock | null = null;

/** 取れなかったときのメッセージ（何が起きたのかを言い切る）。 */
const CONFLICT =
  '別の実 DB の実行が進行中です（同じローカル Supabase を使う `npm run test:integration` / `npm run test:e2e` / `npm run shots` のいずれかが二重に走っています）。' +
  '先に走っているほうの終了を待ってから、もう一度実行してください。';

/**
 * ローカル Supabase を起動し、ロックを取り、マイグレーションを適用する。
 *
 * @param root - Supabase CLI を実行する場所（**利用側が渡す**。仕組み側は製品の根を持たない）
 * @returns 完了を表す Promise
 */
export async function acquire(root: SupabaseRoot): Promise<void> {
  const status = ensureLocalSupabase(root);
  applyEnv(status);
  held = await acquireDbLock(status.DB_URL, CONFLICT);
  // 適用済みの版はスキップされるので、常に流して差分だけを当てる（`db reset` はしない）。
  // 口は統合テストと共有する（[local-supabase.mts](../local/local-supabase.mts) の applyMigrations）。
  applyMigrations(held, root);
}

/**
 * ロックを返す。
 *
 * @returns 完了を表す Promise
 */
export async function release(): Promise<void> {
  if (held === null) return;
  const lock = held;
  held = null;
  await releaseDbLock(lock, true);
}
