/**
 * 飛ばす名前を 1 つも持たない再帰走査。`paths.ts` の `walkFiles` と違って、読めない文字を含む名前も読めなかった場所も黙って落とさないので、
 * 入口の閉世界のように「URL のセグメントになりうる名前を黙って見落とさない」走査はこれを使う。
 *
 * **読めなかった部分を、完全な走査の「0 件」と同じに見せない。** ディレクトリの読み取りの失敗(権限・入出力など)は空の木に変えず、`unreadable` に挙げて返す
 * (呼び手が「見ていない」と言えるように)。**無いこと(ENOENT)だけは読めなかったとは数えない** — 無いものは歩く相手がいない(木が実在するかは呼び手が先に見る)。
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 走査が使うファイルシステムの口(本番は実の fs。読めない状況を作るテストが差し替える)。どちらも失敗したら投げる。 */
export interface WalkFs {
  /** ディレクトリの中の名前を返す。 */
  readonly list: (dir: string) => string[];
  /** ディレクトリなら true(無ければ false)。 */
  readonly isDirectory: (target: string) => boolean;
}

/** 実の fs(`readdirSync` / `statSync`)。 */
const REAL_FS: WalkFs = {
  list: (dir) => readdirSync(dir),
  isDirectory: (target) => statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false,
};

/** 走査の結果。 */
export interface TreeWalk {
  /** 見つけたファイルの絶対パス(名前順・深さ優先)。 */
  readonly files: string[];
  /** 読めなかったディレクトリ(または調べられなかった名前)の絶対パス。空なら完全な走査。無い(ENOENT)ものは入れない。 */
  readonly unreadable: string[];
}

/** 失敗が「無い」(ENOENT)か。 */
function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * ディレクトリを再帰的に走査する。**何も飛ばさない**(ドット始まりも `build` / `coverage` / `node_modules` も歩く。点検 14 回目 C14-1)。呼び手が渡す根は `src/app` のように、出力を持たない木である。
 *
 * @param root 走査の起点
 * @param fs ファイルシステムの口(省略は実の fs)
 * @returns 見つけたファイルと、読めなかった場所
 */
export function walkTree(root: string, fs: WalkFs = REAL_FS): TreeWalk {
  let names: string[];
  try {
    names = fs.list(root).sort();
  } catch (error) {
    return { files: [], unreadable: isAbsent(error) ? [] : [root] };
  }
  const files: string[] = [];
  const unreadable: string[] = [];
  for (const name of names) {
    const target = join(root, name);
    let directory: boolean;
    try {
      directory = fs.isDirectory(target);
    } catch (error) {
      if (!isAbsent(error)) unreadable.push(target);
      continue;
    }
    if (!directory) {
      files.push(target);
    } else {
      const child = walkTree(target, fs);
      files.push(...child.files);
      unreadable.push(...child.unreadable);
    }
  }
  return { files, unreadable };
}
