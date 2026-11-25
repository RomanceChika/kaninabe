/**
 * **囮のリポジトリの証し**の部品(点検 23 回目 C23-1 / C23-3)。11-07 の事故の形 —— 親の環境の `GIT_DIR` / `GIT_INDEX_FILE` などが
 * 子の git の行き先を決める —— を、本物のリポジトリでなく**使い捨ての囮**に向けて再現し、囮が 1 バイトも変わらないことで止めの効きを見る。
 *
 * 子に囮の `GIT_` を渡すのは、この部品の `spawnWithDecoyGitEnv` だけである(テストの側で子を起こす呼び出しは、ほかは全部
 * 隔離の口 `git-env.ts` で作った環境を渡す —— `dev-repo/unit/model/config/test-git-guard.test.ts` の閉世界が見る)。
 * 囮と置き場は呼び手の一時ディレクトリ(リポジトリの外)に作る。置き場がリポジトリの中なら起こさずに断る(止めが効かないと本物に当たるため)。
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedGit } from './git-env.js';

/** このファイルの木の根(リポジトリの根の候補。置き場がこの中なら断る)。 */
const TREE_ROOT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));

/** 囮の作者(`-c` で渡す)。 */
const IDENTITY = ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

/**
 * 置き場 `dir` に囮のリポジトリ(コミット 1 つ)を作る。
 *
 * @param dir 空の置き場
 */
export function makeDecoy(dir: string): void {
  isolatedGit(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'decoy.txt'), 'decoy\n');
  isolatedGit(dir, ['add', '-A']);
  isolatedGit(dir, [...IDENTITY, 'commit', '-q', '-m', 'decoy']);
}

/**
 * 囮に向けたリポジトリを決める変数(pre-commit の中で git がフックに渡す形)。
 *
 * @param decoy 囮のリポジトリの置き場
 */
export function decoyGitVars(decoy: string): Readonly<Record<string, string>> {
  const gitDir = path.join(decoy, '.git');
  return { GIT_DIR: gitDir, GIT_INDEX_FILE: path.join(gitDir, 'index'), GIT_WORK_TREE: decoy, GIT_COMMON_DIR: gitDir, GIT_OBJECT_DIRECTORY: path.join(gitDir, 'objects') };
}

/**
 * 置き場の下のファイルの全部の hash(パス → sha256)。
 *
 * @param dir 置き場
 */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

/** 起こし方。 */
export interface DecoySpawnOptions {
  /** 作業ディレクトリ(リポジトリの外であること)。 */
  readonly cwd: string;
  /** 子の HOME(利用者の大域の設定を読ませない置き場)。 */
  readonly home: string;
  /** 足す変数(`GIT_` でないもの)。 */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * 囮の `GIT_` を持つ環境で子を起こす(PATH と HOME と囮の変数だけ。止めの効きを見るための唯一の口)。
 *
 * @param decoy 囮のリポジトリの置き場
 * @param command 起こす命令
 * @param args 引数
 * @param options 起こし方
 * @returns 子の結果
 */
export function spawnWithDecoyGitEnv(decoy: string, command: string, args: readonly string[], options: DecoySpawnOptions): SpawnSyncReturns<string> {
  const cwd = realpathSync(options.cwd);
  if (cwd === TREE_ROOT || cwd.startsWith(`${TREE_ROOT}${path.sep}`)) throw new Error(`囮の証しの置き場がリポジトリの中です(${cwd})。止めが効かないと本物に当たるので起こしません`);
  for (const key of Object.keys(options.extraEnv ?? {})) if (key.startsWith('GIT_')) throw new Error(`囮の証しに ${key} は足せません(囮の変数は decoyGitVars だけ)`);
  const env = { PATH: process.env['PATH'] ?? '', HOME: options.home, ...options.extraEnv, ...decoyGitVars(decoy) };
  return spawnSync(command, [...args], { cwd, env, encoding: 'utf-8', timeout: 60_000 });
}
