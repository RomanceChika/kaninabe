import { realpathSync } from 'node:fs';
import { delimiter, isAbsolute, resolve, sep } from 'node:path';

/**
 * 統合テストの準備が名前で引く CLI(`supabase` / `docker`)に渡す PATH の濾し(**根の中と依存の置き場の実行ファイルを拾わない**。点検 9 回目 C9-5)。
 *
 * `npm run test:integration` は PATH の先頭に `node_modules/.bin` を足す。npm は入った全部の部品の `bin` をそこへ張るので、依存のどれかが
 * `supabase` / `docker` と同じ名前の bin を持てば、偽物が統合テスト(RLS・RPC の拒否の見張り)の DB を差し替えて空にできる。
 *
 * 判定は道具の側の `legacy/spec-tools/lib/io/safe-path.ts` と、config:doctor の実行器の写しである。
 * 仕組み側のパッケージは道具の木を import しない(ADR-0013)ので写しを置き、同じ判定になることは道具の木の一致テスト
 * (`__tests__/dev-repo/unit/model/config/probe-guard-parity.test.ts`。表は `SEARCH_PATH_CASES`)が見張る。
 *
 * 落とすのは: 空・相対の要素(作業ディレクトリ = 根の中を指す)、`node_modules` を区切りの要素に含むもの、綴りか実体(リンクを辿る)が
 * 根の中のもの。比べるのは畳んだ綴り(NFKC + 小文字 + `ß` → `ss`)。残りの順は変えない(人が入れた CLI を、人の PATH の順で拾う)。
 */

/**
 * パスの綴りを、大文字小文字を区別しない FS が同じとみなす形より広く畳む。
 *
 * @param target - パス
 * @returns 畳んだ綴り
 */
function foldPathSpelling(target: string): string {
  return target.normalize('NFKC').toLowerCase().replace(/ß/gu, 'ss').normalize('NFKC');
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
 * @param pathValue - 引き継いだ PATH
 * @param repoRoot - 根の絶対パス
 * @param realpath - 実体を引く口(テストが差し替える。無い場所は投げる)
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
 * 外部コマンドを名前で引く間だけ、PATH を根の外に絞る(終われば戻す。投げても戻す)。config:doctor の実行器の `withPathOutsideRoot` と同じ形
 * (環境をまるごと組み直して子に渡さないのは、`process.env` を値として渡すと K1 が読めないため)。根を複数渡すと、どの根の中の要素も落とす。
 *
 * @param roots - 根の絶対パスの並び
 * @param run - PATH を絞った間に回すこと
 * @returns `run` の戻り値
 */
export function withPathOutsideRoot<T>(roots: readonly string[], run: () => T): T {
  const inherited = process.env['PATH'];
  process.env['PATH'] = roots.reduce((value, root) => searchPathOutsideRoot(value, root), inherited ?? '');
  try {
    return run();
  } finally {
    if (inherited === undefined) delete process.env['PATH'];
    else process.env['PATH'] = inherited;
  }
}
