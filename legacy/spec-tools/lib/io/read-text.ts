/**
 * テキストファイルを読む小道具(io 層)。
 *
 * 検証器が実装の木・migration・設定ファイルの**中身**を見る項(関門の実装の実在・アダプタの port・
 * Cron の登録・手書きの migration の名指し・語彙漏れの走査)は、`node:fs` を直接 import せず、
 * ここを通す。`node:fs` を触ってよいのは io 層と層の表(`lib-layers.ts`)で宣言された入口だけで、
 * 検証器はその外にある(規約 scripts-code-quality.md「I/O と純粋ロジックの分離」。構造テストが見る)。
 * 「あるか」を見る `isFile` / `isDirectory` / `walkFiles` が `paths.ts` にあるのと対の口である。
 */

import { readFileSync } from 'node:fs';

/**
 * ファイルを UTF-8 で読む。**読めなければ例外のまま投げる**(`readFileSync` と同じ)。
 *
 * 呼び出し側が先に `isFile` で実在を確かめてから読む形のために置く(読めない = 環境の異常で、
 * 黙って空に倒さない)。
 *
 * @param absolute 絶対パス
 * @returns ファイルの本文
 */
export function readText(absolute: string): string {
  return readFileSync(absolute, 'utf8');
}

/**
 * ファイルを UTF-8 で読む。**存在しない・読めない場合は null**(best-effort の走査用)。
 *
 * @param absolute 絶対パス
 * @returns ファイルの本文。読めなければ null
 */
export function tryReadText(absolute: string): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}
