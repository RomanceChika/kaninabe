/**
 * operation の実装ファイルのパスをドメインイベント ID に写す規約(A11 / A14 の共有)。
 *
 * 配置の正は server-actions.md「配置と命名」と ESLint の `layer/operation-naming` であり、
 * ここはその読み取り側である。**写す規約そのもの(土台のディレクトリ・補助ファイルの扱い)は置き場の配置の役割 `operation-logic` の逆引きが持つ**
 * (`lib/model/product/layout.ts` の `layoutScan`。部品化 ③-c4b —— 以前はここが `src/operation/` の綴りを直書きしていた)。
 * **集約でないディレクトリ**(定型・共有物・ジョブ基盤・保存点・テスト支援)の一覧は、置き場の配置が宣言する層と土台の表(`source-root` の `structure`。口は `lib/model/framework-base-dirs.ts`)が持つ
 * (部品化 ③-c5。以前はコアの土台表だった)。
 */

import { layoutScan } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 実装ファイルのパスをドメインイベント ID に写す。
 *
 * @param file リポジトリルートからの相対パス(区切りは "/")
 * @param layout 置き場の配置(アプリの枠の後段が与える。役割 `operation-logic` の走査の根と逆引きを読む)
 * @param roots 製品の根(`app` だけ見る。実装の木を持たない製品は操作の実装も無いので null)
 * @returns `{aggregate}.{event}`。操作ではないファイル(横断・定型・保存点・IF 宣言・操作の本体の置き場の外)は null
 */
export function operationIdOf(file: string, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>): string | null {
  const scan = layoutScan(layout, roots.app, 'operation-logic');
  if (scan === null || !file.startsWith(`${scan.dir}/`)) return null;
  return scan.keyOf(file.slice(scan.dir.length + 1));
}
