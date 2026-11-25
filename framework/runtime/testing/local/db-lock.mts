import { Client } from 'pg';

/**
 * ローカル Supabase の実 DB を「1 つの実行だけが使う」ための多重起動ガード。
 *
 * 統合テスト（`npm run test:integration`）・E2E スモーク（`npm run test:e2e`）・
 * スクリーンショット走査（`npm run shots`）は**同じ 1 つのローカル DB を破壊的に使う**。
 * 統合テストは `db reset` / `resetDatabase` から始まり、後の 2 つは自分の固定データ
 * （催し・申込み）を毎回作り直す（撮影走査もテストではないが、締切まで状態を進める）。どちらか一方が走っている
 * 最中にもう一方が入り込むと、片方のデータが消え、落ち方も再現しない（「同時に実行した」は
 * テストの失敗としてではなく、原因不明の不安定として現れる）。
 *
 * したがって**3 つとも同じロックキーを共有する**（別々のキーにすると、互いを排除できない）。
 * 判断の根拠は「破壊的操作を持つか」であり、両方とも持つ。この置き場（`tests/`）は
 * 統合テストと E2E 系の共有物であり、片方の都合で変えない。
 * 規約: docs/rules/process/backend/system/standards/conventions/testing/integration.md 3節
 */

/**
 * 多重起動ガードに使う advisory lock のキー。
 *
 * 値そのものに意味は無い（このリポジトリの実 DB テストだけが使う任意の定数）。
 * Postgres のセッションに紐づくので、プロセスが死んでも自動で解放される
 * ＝ロックファイル方式と違って「取りっぱなし」の後始末が要らない。
 */
export const DB_LOCK_KEY = 20_260_818;

/**
 * 取得済みのロック。**「実 DB を破壊的に触ってよい」ことの証拠**として持ち回る。
 *
 * `acquireDbLock` だけがこれを作る。スキーマを触る操作（`applyMigrations`）はこれを
 * 引数に要求するので、**ロックの外からは呼べない**（型が通らない）。証拠を値として
 * 渡す形にしてあるのは、「ロックを取ったか」を命名やコメントの規律に頼らないためである。
 */
export interface DbLock {
  /** ロックを保持している接続（セッションが切れればロックも外れる）。 */
  readonly client: Client;
  /** ロックを取った DB の接続文字列（同じ DB に当てていることを呼び側が示せる）。 */
  readonly databaseUrl: string;
}

/**
 * ロックを取る。取れなければ**待たずに失敗する**。
 *
 * 待って順番に流す方式は採らない。待つと「なぜか 10 分終わらない」になり、
 * 同時に実行してしまったこと自体が見えなくなる。
 *
 * @param databaseUrl - ローカル Postgres への接続文字列
 * @param message - 取れなかったときに投げるメッセージ（取得の局面ごとに変える）
 * @returns ロックを保持している接続（= 破壊的操作を許す証拠）
 */
export async function acquireDbLock(databaseUrl: string, message: string): Promise<DbLock> {
  const client = new Client({ connectionString: databaseUrl });
  // `supabase db reset` は接続を切る。pg の Client は接続断を 'error' イベントで通知し、
  // 購読者がいないと **Node が未処理エラーとしてプロセスごと落とす**（ガードのメッセージに
  // たどり着く前に死ぬ）。ここでは握って、失敗は呼び出し側の「取り直し」で表面化させる。
  client.on('error', () => {
    // 接続断そのものは異常ではない（db reset の副作用）。扱いは呼び出し側に委ねる。
  });
  await client.connect();
  const result = await client.query<{ locked: boolean }>(
    'select pg_try_advisory_lock($1::bigint) as locked',
    [DB_LOCK_KEY],
  );
  if (result.rows[0]?.locked !== true) {
    await releaseDbLock({ client, databaseUrl }, false);
    throw new Error(message);
  }
  return { client, databaseUrl };
}

/**
 * ロックを解放して接続を閉じる。接続が既に切れている場合は解放済みなので黙って閉じる。
 *
 * @param lock - `acquireDbLock` が返したロック
 * @param unlock - 明示的に解放するか（接続が既に切れていると分かっている場合は false）
 */
export async function releaseDbLock(lock: DbLock, unlock: boolean): Promise<void> {
  const client = lock.client;
  if (unlock) {
    try {
      await client.query('select pg_advisory_unlock($1::bigint)', [DB_LOCK_KEY]);
    } catch {
      // `db reset` 等で接続が切れていた場合、advisory lock はセッションと一緒に解放済み。
    }
  }
  try {
    await client.end();
  } catch {
    // 閉じられない接続は既に死んでいる。後始末としては完了している。
  }
}
