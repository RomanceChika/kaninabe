/**
 * ローカル Supabase を**一時 workdir の migration で作り直す**口(と、リポジトリの形へ戻す口)。
 *
 * ## なぜ `--workdir` なのか
 *
 * 4 題材は「空の DB に仕様の生成物だけを当てて立ち上がるか」を見たい。ローカルスタック
 * (コンテナ・ポート・鍵)はリポジトリのものを使い回したいが、当てる migration は題材のもの
 * だけにしたい —— `supabase db reset --workdir <一時ディレクトリ>` はちょうどそれで、
 * **リポジトリの `supabase/` を一切読まない**。
 *
 * ## 戻すこと
 *
 * 作り直した DB には製品の表が 1 つも無いので、そのままでは統合テストの前提が壊れる。
 * 実行のあとに**リポジトリの workdir で作り直す**ことが後始末である(統合テストの
 * `global-setup` が「スキーマが無ければ作り直す」のと同じ操作を、こちらから先に済ませる)。
 *
 * ## 多重起動を止める
 *
 * この実行はローカルの実 DB を**破壊的に**使う。統合テスト・E2E・撮影走査と同じ 1 つの DB
 * なので、ガードも同じもの(`@kaninabe/runtime/testing/local/db-lock.mts` の advisory lock)を共有する ——
 * 別のキーにすると互いを排除できない。ロックを持つのは子プロセスである(`pg` が要るが、
 * この通し実行の依存にそれは無い。app の依存を借りる 1 点をここに閉じる)。
 *
 * ## 作り直した直後は「まだ応答しない」
 *
 * `db reset` はサービスを作り直すので、コマンドが返った時点で全部が応答できるとは限らない。
 * **REST は先に上がり、認証は数秒遅れる** —— 速い手元では次のテストが走り出すまでに
 * 間に合い、遅い runner では間に合わずに Kong の 502 で落ちる(2026-09-23 に CI の
 * `samples-db` ジョブが実際にこれで赤くなった)。待ち合わせの実体は統合テストと共有する
 * (`@kaninabe/runtime/testing/local/supabase-ready.mts`)—— 2 つ持つと片方だけ直す非対称ができる。
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { childEnvOutsideRoot } from '../../../io/safe-path.js';
import {
  describeWait,
  localServiceProbes,
  waitForServices,
  type WaitResult,
} from '@kaninabe/runtime/testing/local/supabase-ready';
import { requireStackMark } from '@kaninabe/runtime/testing/local/stack-mark';
import { appPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** ロックを保持する子プロセスの入口(この通し実行と同じディレクトリ)。 */
const LOCK_HOLDER = 'db-lock-holder.mjs';

/** ローカルスタックの接続情報のうち、ここで使う項目。 */
export interface LocalStack {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly databaseUrl: string;
}

/** 実 DB を破壊的に使ってよいことの証拠(ロックを持つ子プロセス)。 */
export interface DbLease {
  readonly holder: ChildProcess;
}

/**
 * `supabase` CLI を回して標準出力を返す(鍵を含むので標準エラーだけ捨てる)。名前は根の中と依存の置き場を落とした PATH で引く
 * (`npm run` が足す `node_modules/.bin` の同名の bin を拾わない。7 回目 C7-6)。
 */
function cli(args: readonly string[], repoRoot: string): string {
  return execFileSync('supabase', [...args], {
    cwd: repoRoot,
    env: childEnvOutsideRoot(process.env, repoRoot),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 起動しているローカルスタックの接続情報を読む。
 *
 * **起動はしない。** 起動していないなら、それは「統合テストを 1 度も回していない手元」で
 * あり、この通し実行が勝手にコンテナを上げるより先に `npm run test:integration` を通すべき
 * 局面である(何が起きたか分かる形で止める)。
 *
 * @param repoRoot リポジトリルート
 * @returns 接続情報。起動していなければ null
 */
export function readLocalStack(repoRoot: string): LocalStack | null {
  try {
    const parsed: unknown = JSON.parse(cli(['status', '-o', 'json'], repoRoot));
    const status = parsed as Partial<Record<string, string>>;
    const apiUrl = status['API_URL'];
    const anonKey = status['ANON_KEY'];
    const serviceRoleKey = status['SERVICE_ROLE_KEY'];
    const databaseUrl = status['DB_URL'];
    if (
      apiUrl === undefined ||
      anonKey === undefined ||
      serviceRoleKey === undefined ||
      databaseUrl === undefined
    ) {
      return null;
    }
    return { apiUrl, anonKey, serviceRoleKey, databaseUrl };
  } catch {
    return null;
  }
}

/**
 * 実 DB を破壊的に使う許可を取る(取れなければ待たずに失敗する)。
 *
 * 待って順番に流す方式は採らない —— 待つと「なぜか終わらない」になり、同時に実行してしまった
 * こと自体が見えなくなる(`db-lock.mts` と同じ判断)。
 *
 * @param databaseUrl ローカル Postgres への接続文字列
 * @param repoRoot リポジトリルート(`pg` を借りる app の位置を解くのに使う)
 * @returns ロックを持つ子プロセス。取れなければ null
 */
export async function acquireDbLease(
  databaseUrl: string,
  repoRoot: string,
  roots: ProductRoots,
): Promise<DbLease | null> {
  // 錠取りは**ホストの実装の木で** npm を回す(依存はそこにある)。位置は宣言から来る。
  const appRoot = appPath(roots);
  if (appRoot === null) return null;
  const holder = spawn(
    process.execPath,
    [path.join(import.meta.dirname, LOCK_HOLDER), databaseUrl],
    { cwd: path.join(repoRoot, appRoot), stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const locked = await new Promise<boolean>((resolve) => {
    let answered = false;
    const settle = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    holder.stdout?.on('data', (chunk: Buffer) => settle(chunk.toString().includes('locked')));
    holder.on('exit', () => settle(false));
  });
  if (locked) return { holder };
  holder.kill();
  return null;
}

/**
 * 許可を返す(子プロセスの標準入力を閉じると、ロックを外して終わる)。
 *
 * @param lease `acquireDbLease` が返した許可
 */
export async function releaseDbLease(lease: DbLease): Promise<void> {
  lease.holder.stdin?.end();
  await new Promise<void>((resolve) => {
    lease.holder.on('exit', () => resolve());
    // 子が応答しない場合でも通し実行を止めない(ロックはセッションが切れれば外れる)。
    setTimeout(() => {
      lease.holder.kill();
      resolve();
    }, 5_000).unref();
  });
}

/** `db reset` 1 回の結末。 */
export interface ResetResult {
  /** 全 migration が通り、**作り直した surface が応答するようになった**か。 */
  readonly ok: boolean;
  /** 所要(ミリ秒。surface が応答するまでの待ちを含む)。 */
  readonly elapsedMs: number;
  /** 落ちたときの出力(通ったときは空)。 */
  readonly output: string;
  /**
   * 作り直したあとの待ち合わせ(migration が落ちて待つ段に届かなければ null)。
   *
   * 待った秒数を呼び側が印字するために持つ —— 「待ちが 0 秒だった」と「待ち合わせを
   * していない」は別のことであり、区別がつかないと CI で遅れて上がる口の穴が戻ってくる。
   */
  readonly ready: WaitResult | null;
}

/**
 * その workdir の migration で DB を作り直し、**surface が応答するまで待つ**。
 *
 * 待たずに返すと、呼び側は「まだ認証が上がっていない DB」を相手にテストを実行する ——
 * 落ち方は Kong の 502 であり、テストの中身をいくら読んでも原因に辿り着かない
 * (このファイルの docstring §作り直した直後は「まだ応答しない」)。
 *
 * @param workdir `supabase/` を持つディレクトリ
 * @param stack ローカルスタックの接続情報(応答を確かめる口とキー)
 * @param repoRoot リポジトリの根(PATH の濾しの根。一時ツリーと両方を落とす)
 * @returns 通ったか・所要・落ちたときの出力・待ち合わせの結末
 */
export async function resetWithWorkdir(workdir: string, stack: LocalStack, repoRoot: string): Promise<ResetResult> {
  const started = Date.now();
  try {
    // 名指し(か使い捨ての runner)があり、写した設定が名指しの stack を指したままかを見る(無い・違えば作り直さずに赤。照らしの本体は
    // @kaninabe/runtime の stack-mark / expected-project。点検 20 回目 C20-1・safety1 = 包まずに起こした samples:db が共用を作り直した事故の再発止め)。
    requireStackMark(workdir);
    // 一時ツリーの外の CLI を、リポジトリの根と一時ツリーの両方の中と依存の置き場を落とした PATH で引く(7 回目 C7-6・8 回目 C8-6:
    // 一時ツリーだけを根にすると、人が PATH に入れたリポジトリの中の置き場 — `<根>/bin` など — が残る)。
    execFileSync('supabase', ['db', 'reset', '--workdir', workdir], {
      cwd: workdir,
      env: childEnvOutsideRoot(process.env, [repoRoot, workdir]),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string };
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` || String(error),
      ready: null,
    };
  }
  const ready = await waitForServices({
    probes: localServiceProbes(stack.apiUrl),
    apiKey: stack.anonKey,
  });
  return {
    ok: ready.ok,
    elapsedMs: Date.now() - started,
    output: ready.ok ? '' : describeWait(ready).join('\n'),
    ready,
  };
}
