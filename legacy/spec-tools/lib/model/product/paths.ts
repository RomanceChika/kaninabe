/**
 * 宣言された根からパスを組み立てる純粋関数群。**仕組みが唯一パスを作れる場所**である。
 *
 * 綴りを持つ側と持たない側の線はこうである ——
 *   - **根そのもの**(仕様の木はどこか・実装の木はどこか)は**製品の事情**であり宣言から来る。
 *   - **仕様の木・読み物の木の中の形**(仕様の木の中で action_spec がどのディレクトリに並ぶか)は**仕組みが決めていること**で、ここが持つ。
 *   - **実装の木の中の形**(ソースの根・ルーティング・土台がどこに並ぶか)は、ここでは組まない(部品化 ③-c6)。**置き場の配置**(`layout.ts` の役割。アプリの枠の後段が値を与える)が決める。
 *     層の 4 名はコアの語(`framework-dirs.ts` の `CORE_LAYERS`)である。
 *
 * どの関数もリポジトリルートからの相対パス(区切りは "/")を返す。絶対パスが要る呼び出し側は
 * `path.join(repoRoot, …)` を自分で行う —— I/O を持たない層だからである。
 */

import type { ProductRoots } from './types.js';

/**
 * 相対パスを "/" で連結する(空の断片は落とす。`path.join` と違って OS 依存が無い)。
 *
 * **解決済みの根を持っている側**が続きを組み立てるための口でもある —— 実装の木の中の位置を
 * 何段も渡り歩く生成器は、置き場の配置で 1 度だけ解決した根をこの関数で伸ばす
 * (根を毎回解き直すと `null` の分岐が数十か所に散る)。
 */
export function joinPath(root: string, ...segments: readonly string[]): string {
  return [root, ...segments].filter((segment) => segment !== '').join('/');
}

/** 内部用の別名(この層の中の読みやすさのため)。 */
const under = (root: string, segments: readonly string[]): string => joinPath(root, ...segments);

/** 仕様の木の中のパス(例: `specPath(roots, 'backend', 'config.md')`)。 */
export function specPath(roots: ProductRoots, ...segments: readonly string[]): string {
  return under(roots.specs, segments);
}

/** 生成される読み物(ハンドブック)の中のパス。 */
export function bookPath(roots: ProductRoots, ...segments: readonly string[]): string {
  return under(roots.book, segments);
}

/** 生成物の総置き場の中のパス。 */
export function generatedPath(roots: ProductRoots, ...segments: readonly string[]): string {
  return under(roots.generated, segments);
}

/** migration の置き場の中のパス。 */
export function migrationPath(roots: ProductRoots, ...segments: readonly string[]): string {
  return under(roots.migrations, segments);
}

/**
 * 実装の木の根そのもの(製品の宣言 `roots.app`)。**実装の木を持たない製品では null**。
 *
 * 呼び出し側は「無いなら見ない」を必ず書く —— そこが仕様だけの製品でも壊れない線である。**実装の木の中の位置**(ソースの根・ルーティング・E2E ほか)は、
 * ここでは組まない —— 置き場の配置(`lib/model/product/layout.ts` の役割。アプリの枠の後段が値を与える)が決める。
 */
export function appPath(roots: ProductRoots): string | null {
  return roots.app;
}

/** ドメイン知識(W 層)の中のパス。持たない製品では null。 */
export function knowledgePath(roots: ProductRoots, ...segments: readonly string[]): string | null {
  return roots.knowledge === null ? null : under(roots.knowledge, segments);
}

/** SSR プレビュー断片の置き場の中のパス。持たない製品では null。 */
export function previewsPath(roots: ProductRoots, ...segments: readonly string[]): string | null {
  return roots.previews === null ? null : under(roots.previews, segments);
}

/**
 * ローカルスタックの宣言の置き場(migration の置き場の 1 つ上)。
 *
 * Supabase CLI は「設定ファイルと migration を兄弟として持つ 1 つのディレクトリ」を前提にする
 * ので、migration の置き場を宣言すればその親が答えになる —— 製品が置き場を動かせば一緒に動く。
 * migration をリポジトリ直下に置いた製品では空文字(= リポジトリルートそのもの)になる。
 */
export function stackDirPath(roots: ProductRoots): string {
  return roots.migrations.split('/').slice(0, -1).join('/');
}

/** ローカルスタックの設定ファイル(migration の置き場の隣の `config.toml`)。 */
export function stackConfigPath(roots: ProductRoots): string {
  return under(stackDirPath(roots), ['config.toml']);
}
