/**
 * 道具の CLI(`cli/*.ts`)を**別プロセスで**動かすテストの共通の道具(本物の入口の配線を見るテストが使う)。
 *
 * 親(npm 経由のテスト実行・pre-commit フック)の環境をそのまま継ぐと、「いま居る場所」を決める変数が子の根の探索に
 * 混ざる —— git の `GIT_*`(使い捨ての木に親の index を見せる)と、npm が置く `npm_*` / `INIT_CWD`
 * (npm が起動された場所。作業ディレクトリの代わりに見る CLI があると結果が変わる)。`childEnv` がそれを外す。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMEWORK_SPEC_TOOLS_DIR } from '../../lib/io/paths.js';
import { withoutGitEnv } from './git-env.js';

/** リポジトリのルート(このファイルは `legacy/spec-tools/__tests__/helpers/` にある)。 */
export const TOOL_ROOT = path.resolve(import.meta.dirname, '../../../..');
/** 道具の木(`legacy/spec-tools`)。 */
export const TOOL_TREE = path.join(TOOL_ROOT, FRAMEWORK_SPEC_TOOLS_DIR);
/** 道具の木の `tsx`(`node --import tsx` の代わりに直接呼ぶ口)。 */
export const TSX = path.join(TOOL_TREE, 'node_modules', '.bin', 'tsx');

/** 子プロセスの結果。 */
export interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 子プロセスに渡す環境(親の `GIT_*` と npm の `INIT_CWD` / `npm_*` を外したもの)。
 *
 * @returns `spawnSync` の `env` にそのまま渡せる環境
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env = withoutGitEnv();
  for (const key of Object.keys(env)) {
    if (key === 'INIT_CWD' || key.startsWith('npm_') || key.startsWith('NPM_')) delete env[key];
  }
  return env;
}

/**
 * 定理証明器(`z3-solver`。WebAssembly のスレッド)が**終了の間際に**標準エラーへ出す 1 行。
 *
 * `received "cleanupThread" command from terminated worker: N` は Emscripten の pthread の実装が
 * 出す文言で、プロセスの終わりにワーカーを畳む順序が負荷で入れ替わった日にだけ出る(単独の実行では
 * 出ない。並列の全体実行で「標準エラーが空」が落ちた = 網の穴探し 2026-10-06 の O3)。
 * **CLI の振る舞いの誤りではなく第三者のランタイムの終了ログ**なので、この 1 行の形だけを取り除いてから
 * 「標準エラーが空であること」を見る(それ以外の標準エラーは 1 文字も緩めない)。
 *
 * @param stderr 子の標準エラー
 * @returns 終了ログの行を除いた標準エラー
 */
export function withoutSolverExitNoise(stderr: string): string {
  return stderr.replace(/^received "cleanupThread" command from terminated worker: \d+\r?\n?/gm, '');
}

/**
 * 道具を子プロセスで動かす(`tsx <cli> …`)。
 *
 * @param cli 実行するファイルの絶対パス
 * @param cwd 作業ディレクトリ
 * @param args CLI の引数
 * @param extraEnv 子の環境に足す変数(親から継いだ分は `childEnv` が外してある)
 * @returns 終了コードと出力
 */
export function runToolCli(cli: string, cwd: string, args: readonly string[] = [], extraEnv: NodeJS.ProcessEnv = {}): CliRun {
  const env = withoutGitEnv({ ...childEnv(), ...extraEnv });
  const result = spawnSync(TSX, [cli, ...args], { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, env });
  return { status: result.status, stdout: result.stdout, stderr: withoutSolverExitNoise(result.stderr) };
}

/** `runToolCliRecorded` の結果(子プロセスの結果に、読み込んだモジュールの一覧を足したもの)。 */
export interface RecordedCliRun extends CliRun {
  /** 子が読み込んだモジュールの絶対パス(`file:` のものだけ。読み込んだ順・重複あり)。 */
  readonly loaded: readonly string[];
}

/** 読み込みの記録を書く道具(`node --import` で渡す。実体は `record-module-loads.mjs`)。 */
const RECORDER = path.join(import.meta.dirname, 'record-module-loads.mjs');

/**
 * 道具を子プロセスで動かし、**実行時に読み込まれたモジュールの一覧**を一緒に返す。
 *
 * 作業ディレクトリは道具の木にする(`--import tsx` の解決の起点。製品の根は引数 `--root` で渡す)。
 * 「入口が SQL の層・変異の層を読み込まない」ことを、静的な閉包(C28)に加えて**実際に実行して**確かめるための口である。
 *
 * @param cli 実行するファイルの絶対パス
 * @param args CLI の引数(`--root <製品の根>` を含める)
 * @param logFile 読み込みの記録の置き場(絶対パス。呼び側が一時ディレクトリに決める)
 * @returns 終了コード・出力・読み込んだモジュール
 */
export function runToolCliRecorded(cli: string, args: readonly string[], logFile: string): RecordedCliRun {
  const env = withoutGitEnv({ ...childEnv(), MODULE_LOAD_LOG: logFile });
  const result = spawnSync(process.execPath, ['--import', RECORDER, '--import', 'tsx', cli, ...args], {
    cwd: TOOL_TREE,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  const loaded = existsSync(logFile)
    ? readFileSync(logFile, 'utf-8')
        .split('\n')
        .filter((line) => line.startsWith('file://'))
        .map((line) => fileURLToPath(line))
    : [];
  return { status: result.status, stdout: result.stdout, stderr: withoutSolverExitNoise(result.stderr), loaded };
}
