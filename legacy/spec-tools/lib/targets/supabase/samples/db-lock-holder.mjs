/**
 * 実 DB の多重起動ガード(advisory lock)を**保持し続ける**だけの子プロセス。
 *
 * なぜ別プロセスなのか: ロックの実体は `@kaninabe/runtime/testing/local/db-lock.mts` にあり(統合テスト・E2E・
 * 撮影走査と同じキーを共有する。別のキーにすると互いを排除できない)、そこは `pg` を使う。
 * `pg` は app の依存であって通し実行(docs)の依存ではないので、**借りる 1 点をこのプロセスに
 * 閉じる** —— 起動時の作業ディレクトリが app なので、`pg` はそちらから解決される。
 *
 * 約束: 取れたら標準出力に `locked` を 1 行書き、標準入力が閉じるまで待つ。取れなければ
 * 理由を標準エラーに書いて終了コード 1 で終わる。**親はロックを値として持たない** ——
 * この子が生きていることがロックを持っていることそのものである(セッションが切れれば
 * Postgres 側でも外れるので、親が落ちても取りっぱなしにならない)。
 */

import { acquireDbLock, releaseDbLock } from '@kaninabe/runtime/testing/local/db-lock';

const databaseUrl = process.argv[2];
if (databaseUrl === undefined || databaseUrl === '') {
  process.stderr.write('接続文字列が渡されていません(第 1 引数に SUPABASE_DB_URL 相当を渡す)。\n');
  process.exit(1);
}

const CONFLICT =
  '別の実 DB の実行が走っています(同じローカル Supabase を使う統合テスト / E2E / 撮影走査 / この通し実行)。' +
  '先に走っているほうの終了を待ってから、もう一度実行してください。';

let lock;
try {
  lock = await acquireDbLock(databaseUrl, CONFLICT);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

process.stdout.write('locked\n');

// 標準入力が閉じたら解放して終わる(親が「終わった」と言う唯一の合図)。
process.stdin.resume();
process.stdin.on('end', () => {
  void finish();
});

/** ロックを外して終わる。 */
async function finish() {
  await releaseDbLock(lock, true);
  process.exit(0);
}
