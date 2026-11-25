/**
 * Route Handler の生テキストを読む(生成テストが「どのメソッドを export しているか」を構文木で取る入力)。
 *
 * 生成器は I/O をしない規約なので、ジョブカタログの `endpoint` が指す Route Handler の本文は
 * ここ(`generate-context.ts` 経由の同じ 1 本)が読んで文脈(`GenerateContext.routeSources`)に載せる。
 * 読み方の母集合は**ジョブカタログの `endpoint` を持つ行**と、**送信の連携の `endpoints`** と、**認証フロー仕様の `start` / `logout`**
 * (後の 2 つは cookie で認証する手書きの口。ブラウザ側の守りの見張りテストが状態を変えるメソッドを全部叩き、口が import した依存を
 * 代役に差し替える —— どちらも本文の構文木が要る)だけで、位置は置き場の配置の `http-entry`(宣言された根と配置から組む)。
 */

import path from 'node:path';
import { isFile } from '../io/paths.js';
import { readText } from '../io/read-text.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { ExternalSpecModel } from '../model/external/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import { httpEntryPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * ジョブカタログの起動口と、送信の連携の `endpoints` と、認証の開始・ログアウトの口の Route Handler を全部(リポジトリルート相対 → 生テキスト)読む。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(`http-entry` の位置を引く)
 * @param jobs 読み込み済みのジョブカタログ(無ければ空)
 * @param external 読み込み済みの外部連携カタログ(無ければ送信の連携の口は読まない)
 * @param auth 読み込み済みの認証フロー仕様(無ければ開始・ログアウトの口は読まない)
 * @returns 実在した Route Handler だけの写し
 */
export function readRouteSources(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  jobs: JobSpecModel | undefined,
  external?: ExternalSpecModel,
  auth?: AuthSpecModel,
): Map<string, string> {
  const sources = new Map<string, string>();
  const endpoints = [
    ...(jobs?.catalog?.jobs ?? []).flatMap((decl) => (decl.schedule?.endpoint === undefined ? [] : [decl.schedule.endpoint])),
    ...(external?.catalog?.integrations ?? []).flatMap((integration) => (integration.direction === 'inbound' ? [] : (integration.endpoints ?? []))),
    ...[auth?.flow?.start, auth?.flow?.logout].flatMap((decl) => (decl === undefined ? [] : [decl.endpoint])),
  ];
  for (const endpoint of endpoints) {
    const route = httpEntryPath(layout, roots, endpoint);
    if (route !== null && !sources.has(route) && isFile(path.join(repoRoot, route))) {
      sources.set(route, readText(path.join(repoRoot, route)));
    }
  }
  return sources;
}
