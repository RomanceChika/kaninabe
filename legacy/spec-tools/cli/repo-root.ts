/**
 * CLI の入口が**製品の根を決める**共通の口。
 *
 * 根は**呼ばれた場所から上へ `product.md` を探して**決める(道具が自分の場所から探すのではない —— 道具を
 * 製品の木の外に置いても、製品の木の中で呼べば動く)。`--root <path>` で上書きできる。
 *
 * **「呼ばれた場所」は `INIT_CWD`(npm が起動された場所)があればそこ、無ければ作業ディレクトリ**である。
 * ルートの取り次ぎ(`npm run verify` = `npm --prefix legacy/spec-tools run verify`)は作業ディレクトリが
 * 道具の木になるので、相対の引数と相対の `--root` を作業ディレクトリ基準で解くと「ルートで打った相対パス」が
 * 道具の木基準になってしまう。`INIT_CWD` を見れば、打った場所(ルート)基準に解ける。
 * 全 CLI が同じ綴り・同じ説明文(`lib/io/messages.ts` の `ROOT_OPTION_HELP`)でこの口を通る。
 *
 * この CLI だけが `process.exit` を呼ぶ(ライブラリは投げるだけ)。
 */

import path from 'node:path';
import process from 'node:process';
import { isFile, PRODUCT_DECL_FILE, requireRepoRoot } from '../lib/io/paths.js';
import { ROOT_MESSAGES, ROOT_OPTION } from '../lib/io/messages.js';
import { valueOption, withoutValueOption } from './value-option.js';

/**
 * 呼ばれた場所(相対の引数と相対の `--root` を解く基準・根の探索の起点)。
 *
 * `INIT_CWD`(npm が起動された場所)が空でなければそれ、無ければ作業ディレクトリ。
 *
 * @param env 環境変数(既定は `process.env`)
 * @param cwd 作業ディレクトリ(既定は `process.cwd()`)
 * @returns 呼ばれた場所の絶対パス
 */
export function invocationDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const initCwd = env['INIT_CWD'];
  return initCwd === undefined || initCwd === '' ? cwd : path.resolve(initCwd);
}

/** 引数から `--root` とその値(`--root <path>` / `--root=<path>`)を取り除いた残り(他の引数の解釈を邪魔しないため)。 */
export function withoutRootOption(args: readonly string[]): string[] {
  return withoutValueOption(args, ROOT_OPTION, { skipOptionLikeValue: true });
}

/** 根を決めた結果(失敗は文言つきで返す)。 */
export type RootResolution = { readonly ok: true; readonly root: string } | { readonly ok: false; readonly message: string };

/**
 * 製品の根を決める。
 *
 * @param args CLI の引数(`--root <path>` / `--root=<path>` があればそれが勝つ)
 * @param cwd 探索の起点と相対の `--root` の基準(既定は呼ばれた場所。`invocationDir`)
 * @returns 根の絶対パス。決められなければ人に見せる文言
 */
export function resolveRepoRoot(args: readonly string[], cwd: string = invocationDir()): RootResolution {
  const option = valueOption(args, ROOT_OPTION);
  if (option.kind === 'missing') return { ok: false, message: ROOT_MESSAGES.missingValue };
  if (option.kind === 'value') {
    const root = path.resolve(cwd, option.value);
    if (!isFile(path.join(root, PRODUCT_DECL_FILE))) {
      return { ok: false, message: ROOT_MESSAGES.noDeclarationAt(root, PRODUCT_DECL_FILE) };
    }
    return { ok: true, root };
  }
  try {
    return { ok: true, root: requireRepoRoot(cwd) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 根を決める。決められなければ文言を標準エラーに出して終了コード 1 で止まる。
 *
 * @param command 文言の頭に付けるコマンド名(例: `generate`)
 * @param args CLI の引数
 * @returns 根の絶対パス
 */
export function repoRootOrExit(command: string, args: readonly string[]): string {
  const resolved = resolveRepoRoot(args);
  if (resolved.ok) return resolved.root;
  console.error(`${command}: ${resolved.message}`);
  process.exit(1);
}
