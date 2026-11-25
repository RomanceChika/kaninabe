/**
 * Route Handler 以外の**実装の木の入口**(Server Action・ページ・レイアウト・サーバーコンポーネント・リクエスト前段)のファイルを集める(X8 の材料)。
 *
 * 有料の連携に届く道は、宣言した口(共通の入口 `runPaidEntry` で包んだ Route Handler)の 1 本だけにする。画面のツリーの下(入口の置き場の根の下)の
 * テストでないコードのファイルのうち、Route Handler でないもの全部と、実装の木の根の直下の**枠が呼ぶファイル**(リクエスト前段の `proxy` / `middleware` と、
 * 起動時の `register()`・サーバで失敗した要求ごとの `onRequestError()` を枠が呼ぶ `instrumentation` / `instrumentation-client`。点検 7 回目 B7-6)を返す。
 * 純粋な集め方で、読む先は配置の逆引きと実の fs(`walkTree`)。
 */

import path from 'node:path';
import { isFile, listEntries, toRelative } from '../io/paths.js';
import { walkTree } from '../io/walk-tree.js';
import type { WalkFs } from '../io/walk-tree.js';
import { layoutScan, sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** コードのファイルの拡張子。 */
const CODE = /\.[cm]?[jt]sx?$/u;

/** テストのファイル・置き場。 */
const TEST = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * 実装の木の根の直下にあって**枠が呼ぶ**ファイル名(拡張子を除く。許可表)。Next.js 16 は `proxy`(旧 `middleware`)を要求ごとに、
 * `instrumentation` の `register()` を起動時に・`onRequestError()` をサーバで失敗した要求ごとに、`instrumentation-client` をブラウザの起動時に呼ぶ。
 * どれも Route Handler でない入口として、有料の連携に届かないこと・閉包が欠けていないことを見る(7 回目 B7-6)。
 */
export const FRAME_ROOT_ENTRIES: ReadonlySet<string> = new Set(['proxy', 'middleware', 'instrumentation', 'instrumentation-client']);

/**
 * Route Handler でない入口のファイルを返す。
 *
 * @param repoRoot リポジトリルート(絶対)
 * @param layout 置き場の配置
 * @param roots 製品の根
 * @param fs 走査が使うファイルシステムの口(省略は実の fs)
 * @returns リポジトリルート相対のパス(名前順)
 */
export function nonRouteEntries(repoRoot: string, layout: ProductLayout, roots: ProductRoots, fs?: WalkFs): readonly string[] {
  const scan = layoutScan(layout, roots.app, 'http-entry');
  const entries: string[] = [];
  if (scan !== null) {
    const dir = path.join(repoRoot, scan.dir);
    for (const absolute of walkTree(dir, fs).files) {
      const relative = toRelative(dir, absolute);
      const route = scan.entryOf === undefined ? scan.keyOf(relative) !== null : scan.entryOf(relative);
      if (CODE.test(relative) && !TEST.test(relative) && !route) entries.push(toRelative(repoRoot, absolute));
    }
  }
  const source = sourceRootPath(layout, roots);
  if (source !== null) {
    const base = path.join(repoRoot, source);
    for (const name of listEntries(base)) {
      if (CODE.test(name) && FRAME_ROOT_ENTRIES.has(name.replace(CODE, '')) && isFile(path.join(base, name))) entries.push(toRelative(repoRoot, path.join(base, name)));
    }
  }
  return entries;
}
