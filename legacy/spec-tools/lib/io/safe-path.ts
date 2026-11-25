/**
 * 子のコマンドに渡す PATH の濾し(**根の中と依存の置き場の実行ファイルを拾わない**。7 回目 C7-6)。
 *
 * `npm run …` / `npm --prefix legacy/spec-tools run …` は PATH の先頭に `<根>/node_modules/.bin`・道具の木の `node_modules/.bin`・
 * その上の各階層の `node_modules/.bin` を足す。npm は入った全部の部品の `bin` をそこへ張るので、依存のどれかが `npm` / `supabase` と
 * 同じ名前の bin を持てば、`execFile('npm', …)`(deps:check の audit・署名・SBOM)や `execFileSync('supabase', …)`(題材の実 DB)が
 * その偽物を動かす(偽物は「脆弱性 0 件」の形を返して検査を緑にできる)。
 *
 * 判定は config:doctor の実行器(`app/scripts/config/probe-guard.ts` の `searchPathOutsideRoot`)と、仕組み側の統合テストの準備
 * (`framework/runtime/testing/local/search-path.mts`。`supabase` / `docker`。9 回目 C9-5)の写しで、同じ判定になることは
 * `__tests__/dev-repo/unit/model/config/probe-guard-parity.test.ts` が同じ表(`__tests__/helpers/search-path-cases.ts` の `SEARCH_PATH_CASES`)を
 * 3 つに当てて見張る(別のツールチェーンなので import できない)。名前で引く呼び出しが濾しを通ることは同じ置き場の `named-cli-path.test.ts` が見る。
 *
 * 落とすのは: 空・相対の要素(作業ディレクトリ = 根の中を指す)、`node_modules` を区切りの要素に含むもの、綴りか実体(リンクを辿る)が
 * 根の中のもの。**比べるのは畳んだ綴り**(NFKC + 小文字 + `ß` / `ẞ` → `ss`。大文字小文字を区別しない FS(macOS の APFS)で、大文字小文字だけ違う綴りの
 * 根の中の要素が残らないように。7 回目 C7-3・`ß` は 8 回目 C8-6: APFS は `ß` を `ss` と同じ名前とみなすが、NFKC + 小文字では畳まれない)。実体は OS が持つ綴り(`realpathSync.native`)で引く。区別する FS で畳むと、大文字小文字
 * だけ違う根の外の場所も落ちるが、落とす側(拾わない側)に寄るだけである。残りの順は変えない(人が入れた CLI を、人の PATH の順で拾う)。
 */

import { realpathSync } from 'node:fs';
import { delimiter, isAbsolute, resolve, sep } from 'node:path';

/**
 * パスの綴りを、大文字小文字を区別しない FS が同じとみなす形より広く畳む(NFKC → 小文字 → `ß` を `ss` → NFKC)。
 * `ß`(U+00DF)と `ẞ`(U+1E9E。小文字にすると `ß`)は、APFS が `ss` と同じ名前とみなす(完全な case folding。8 回目 C8-6 の総当たりで実測)。
 *
 * @param target パス
 */
export function foldPathSpelling(target: string): string {
  return target.normalize('NFKC').toLowerCase().replace(/\u00df/gu, 'ss').normalize('NFKC');
}

/** 畳んだ綴りでパスが根の中か(根そのものを含む)。 */
function insideRoot(target: string, root: string): boolean {
  const folded = foldPathSpelling(target);
  const base = foldPathSpelling(root);
  return folded === base || folded.startsWith(`${base}${sep}`);
}

/** 畳んだ綴りで `node_modules` を区切りの要素に含むか。 */
function underNodeModules(target: string): boolean {
  return foldPathSpelling(target).split(sep).includes('node_modules');
}

/**
 * 根の中と依存の置き場を落とした PATH。
 *
 * @param pathValue 引き継いだ PATH
 * @param repoRoot 根の絶対パス
 * @param realpath 実体を引く口(テストが差し替える。無い場所は投げる)
 * @returns 落とした残りを区切りでつないだもの
 */
export function searchPathOutsideRoot(pathValue: string, repoRoot: string, realpath: (target: string) => string = realpathSync.native): string {
  const spelledRoot = resolve(repoRoot);
  let realRoot: string;
  try {
    realRoot = realpath(repoRoot);
  } catch {
    realRoot = spelledRoot;
  }
  const inside = (target: string): boolean => insideRoot(target, spelledRoot) || insideRoot(target, realRoot);
  const kept = pathValue.split(delimiter).filter((entry) => {
    if (entry === '' || !isAbsolute(entry)) return false;
    const spelled = resolve(entry);
    if (underNodeModules(spelled) || inside(spelled)) return false;
    try {
      const real = realpath(spelled);
      return !inside(real) && !underNodeModules(real);
    } catch {
      // 無い場所は実行ファイルを持たない(綴りは上で根の外と確かめた)。
      return true;
    }
  });
  return kept.join(delimiter);
}

/**
 * 子のコマンドに渡す環境(PATH だけを濾した写し。ほかの変数は変えない)。根を複数渡すと、どの根の中の要素も落とす
 * (一時ツリーで走るコマンドは、一時ツリーとリポジトリの根の両方を落とす。8 回目 C8-6)。
 *
 * @param env 引き継ぐ環境
 * @param repoRoot 根の絶対パス(複数可)
 */
export function childEnvOutsideRoot(env: Readonly<Record<string, string | undefined>>, repoRoot: string | readonly string[]): Record<string, string | undefined> {
  const roots = typeof repoRoot === 'string' ? [repoRoot] : repoRoot;
  return { ...env, PATH: roots.reduce((value, root) => searchPathOutsideRoot(value, root), env.PATH ?? '') };
}
