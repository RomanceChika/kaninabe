/**
 * 一時ツリーに置く「サーバー専用マーカーの空の実体」。
 *
 * `import 'server-only'` は Node で実行すると例外を投げる(クライアントバンドルへの混入を
 * 止めるための仕掛け。ARCH-BE-0001 の E7)。テストでは空のモジュールに差し替える。
 *
 * **ホストの `node_modules` の中を指さない。** ワークスペースの依存は hoist されるかどうかで
 * 居場所が変わる —— 実測: 実行時パッケージが `server-only` を宣言した瞬間に
 * `app/node_modules` からリポジトリルートへ上がり、一時ツリーの相対パスから解けなくなった
 * (束 ①-b・ADR-0013)。中身は空なので、**一時ツリーに自分で置く**ほうが正しい ——
 * 通し実行がホストの依存の配置に依存しなくなる。
 *
 * 一時ツリーには vitest の設定が 2 つある(生成テスト用と構造の突合用)ので、名前と書き出しを
 * ここ 1 か所が持って両方が読む。
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** 実装の木の直下に置くファイル名(vitest の alias が指す先)。 */
export const SERVER_ONLY_STUB = 'server-only-empty.mjs';

/**
 * 一時ツリーの実装の木に空の実体を置く。
 *
 * @param appDir 一時ツリーの実装の木の絶対パス
 */
export function writeServerOnlyStub(appDir: string): void {
  writeFileSync(
    path.join(appDir, SERVER_ONLY_STUB),
    '// 通し実行が置く「サーバー専用マーカー」の空の実体(本物も空のモジュールである)。\n',
  );
}
