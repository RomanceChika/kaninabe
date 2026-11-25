/**
 * 基点(base)の生成物を **git から読む**ただ 1 か所。
 *
 * 差分の元は既にコミットされている生成物なので、仕様を 2 回読み直す必要は無い ——
 * 旧版は `git show <ref>:<path>` の文字列として取る(設計メモ §0)。
 *
 * 流儀は `lib/gates/migration-diff.ts` と同じである ——
 * **git の呼び出しは注入**(`GitRunner`)し、結末を 3 つに分けて畳まない:
 * - 読めた(中身)
 * - **その版に無かった**(`null`。新しい集約は全行が「増えた」側になる)
 * - **git が答えなかった**(判定できない = 赤。黙って「差分なし」に倒さない)
 *
 * ワークツリー側(head)の読み取りは CLI の仕事であり、ここには無い。
 */

import type { GitResult, GitRunner } from '../gates/migration-diff.js';

export type { GitResult, GitRunner };

/** 1 ファイルの読み取りの結末(3 分割)。 */
export type ReadOutcome =
  /** 読めた。 */
  | { readonly kind: 'found'; readonly content: string }
  /** その版に存在しなかった(判定できるので通す)。 */
  | { readonly kind: 'absent' }
  /** git が答えなかった(判定できない)。 */
  | { readonly kind: 'unavailable'; readonly reason: string };

/** 片側の生成物を引く口(git 版とワークツリー版が同じ形を満たす)。 */
export interface SideReader {
  /** その版の 1 ファイルを読む。 */
  readonly read: (path: string) => ReadOutcome;
  /** その版のディレクトリ直下で、接尾辞に合うファイルのパスを名前順に並べる。 */
  readonly list: (dir: string, suffix: string) => readonly string[];
}

/** その ref が実在するコミットか。 */
export function commitExists(run: GitRunner, ref: string): boolean {
  return run(['cat-file', '-e', `${ref}^{commit}`]).ok;
}

/** git 自体が答えるかを 1 回だけ探る(「ref が無い」と「リポジトリを読めない」を分けるため)。 */
export function gitSilentReason(run: GitRunner): string | null {
  const probe = run(['rev-parse', '--git-dir']);
  return probe.ok ? null : `git が答えませんでした(リポジトリを読めません): ${probe.reason}`;
}

/**
 * 「その版にファイルが無い」のか「git が答えない」のかを、git の返事の文面から分ける。
 *
 * git は存在しないパスにも壊れたリポジトリにも失敗を返すので、**存在しないパスだけ**を
 * 通す判定がここに要る。`git show` は前者で「exists on disk, but not in」または
 * 「does not exist in」または「pathspec ... did not match」と言う。
 */
function isMissingPath(reason: string): boolean {
  return /exists on disk|does not exist in|did not match|unknown revision|invalid object name/.test(reason);
}

/**
 * ある ref の版を読む口を作る。
 *
 * @param run git を回す口(CLI が `execFileSync` で与える)
 * @param ref 読み出すコミット
 * @returns その版の生成物を引く口
 */
export function gitSide(run: GitRunner, ref: string): SideReader {
  return {
    read: (path: string): ReadOutcome => {
      const result: GitResult = run(['show', `${ref}:${path}`]);
      if (result.ok) return { kind: 'found', content: result.stdout };
      if (isMissingPath(result.reason)) return { kind: 'absent' };
      return { kind: 'unavailable', reason: `git show ${ref}:${path} が失敗しました: ${result.reason}` };
    },
    list: (dir: string, suffix: string): readonly string[] => {
      const result = run(['ls-tree', '--name-only', `${ref}:${dir}`]);
      if (!result.ok) return [];
      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && line.endsWith(suffix))
        .map((line) => `${dir}/${line}`)
        .sort();
    },
  };
}
