import { execFileSync } from 'node:child_process';
import { withPathOutsideRoot } from './search-path.mjs';

/**
 * Docker が**応答するか**を、起動の前に確かめる。
 *
 * ## なぜ要るのか
 *
 * ローカル Supabase は Docker の上で動く。Docker のデーモンが固まっていると、後段の
 * `supabase status` / `supabase start` が**返ってこない**ので、統合テストは何のメッセージも
 * 出さずに止まって見える(原因が Docker であることは、テストの中身をいくら読んでも分からない)。
 * そこで最初に `docker info` を短い上限つきで呼び、返らなければ**原因を 1 行で言い切って落ちる**。
 *
 * 呼ぶ道具(`run`)は引数で受ける(実物を起こさずに単体で実行できるようにするため)。
 */

/** 応答を待つ上限(既定 30 秒)。 */
export const DOCKER_TIMEOUT_MS = 30_000;

/** Docker が応答しないときのメッセージ(直し方まで言い切る)。 */
export const DOCKER_UNRESPONSIVE_MESSAGE =
  'Docker が応答しません(`open -a Docker` で起こしてください)。ローカル Supabase は Docker の上で動くため、このまま進むと固まります。';

/**
 * `docker info` を上限つきで実行する既定の実装(返らない・失敗したら例外)。PATH から作業ディレクトリの中と `node_modules` を落とす
 * (`npm run` の下では依存の同じ名前の bin が先に当たるため。点検 9 回目 C9-5)。
 */
function runDockerInfo(timeoutMs: number): void {
  withPathOutsideRoot([process.cwd()], () => execFileSync('docker', ['info'], { stdio: 'ignore', timeout: timeoutMs }));
}

/**
 * Docker が応答することを確かめる。応答しなければ 1 行の診断で落とす。
 *
 * @param options - 調整(上限と、`docker info` を実行する実装の差し替え)
 * @param options.timeoutMs - 応答を待つ上限(ミリ秒)
 * @param options.run - `docker info` の代わりに呼ぶ実装(返らなければ例外を投げる)
 * @throws Docker が上限内に応答しなかったとき
 */
export function assertDockerResponds(options: {
  readonly timeoutMs?: number;
  readonly run?: (timeoutMs: number) => void;
} = {}): void {
  const timeoutMs = options.timeoutMs ?? DOCKER_TIMEOUT_MS;
  const run = options.run ?? runDockerInfo;
  try {
    run(timeoutMs);
  } catch {
    throw new Error(DOCKER_UNRESPONSIVE_MESSAGE);
  }
}
