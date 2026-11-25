/**
 * ディレクトリ木のソース(`.ts` / `.mts` / `.cts` / `.tsx` / `.js` / `.mjs` / `.cjs`)を**再帰で全部**読み、
 * `相対パス → 本文` の写しにして返す。拡張子は `paths.ts` の `FRAMEWORK_CODE_EXTENSIONS`(仕組み側のコードの
 * 値域)で、**現物が無い拡張子も数える** —— `.mts` や `.tsx` を足した日から層の検査の範囲に入る。
 *
 * 層の構造テスト(`lib/gates/layer-check.ts`)は import を AST で数えるが、木を歩いて
 * ファイルを読む仕事はここ(io 層)に寄せてある —— 検査器の本体は本文の写しだけを受けて
 * 純関数で判定するので、一時ツリーを作らなくてもわざと壊す確認を単体で固定できる。
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_CODE_EXTENSIONS } from './paths.js';

/**
 * `root` の下の `.ts` ファイルを再帰で読む。
 *
 * @param root 歩き始めるディレクトリ(絶対パス)
 * @param prefix 返すキーの先頭に付ける綴り(例: `lib/`)。層の表のパターンはこの綴りから始まる
 * @returns `prefix + root からの相対パス`(`/` 区切り)→ ファイルの本文。キーの昇順
 */
export function readTsTree(root: string, prefix: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), child);
      } else if (FRAMEWORK_CODE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.set(`${prefix}${child}`, readFileSync(path.join(dir, entry.name), 'utf-8'));
      }
    }
  };
  walk(root, '');
  return found;
}
