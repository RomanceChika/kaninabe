/**
 * lockfile の通信の要らない検査 CLI(`npm run deps:check:offline`。6 回目 C6-3)。
 *
 * 使い方: npm run deps:check:offline [-- --root <path>]
 *   - 許さない lockfile(npm-shrinkwrap.json・yarn.lock など。大文字小文字を区別しない)の存在と、各 package-lock.json の形・配信元と固定・
 *     同梱・手元の置き場の宣言を見る(登録簿・audit・OSV・署名には繋がない)
 *   - 終了コード: 赤が 1 件でもあれば 1
 *
 * **依存を入れる前に実行する**(CI の各 `npm ci` の前)。なので tsx ではなく `node` で直に読む: `node --import ./cli/ts-js-resolve.mjs cli/deps-check-offline.ts`
 * (Node の型の除去で `.ts` を読み、`ts-js-resolve.mjs` が `./x.js` の import を隣の `./x.ts` に向ける)。ここから辿る部品は `node:` 以外を import しない。
 * 結果のファイルは書かない(`deps:check` の `LATEST_FILE` は通信する検査の結果の置き場)。
 */

import path from 'node:path';
import process from 'node:process';
import { isDirectory, listEntries } from '../lib/io/paths.js';
import { tryReadText } from '../lib/io/read-text.js';
import { formatDepsOffline, runDepsOffline } from '../lib/deps/offline.js';
import { repoRootOrExit } from './repo-root.js';

const root = repoRootOrExit('deps:check:offline', process.argv.slice(2));
const abs = (rel: string): string => path.join(root, rel);
const report = runDepsOffline({
  readText: (rel) => tryReadText(abs(rel)),
  isDirectory: (rel) => isDirectory(abs(rel)),
  list: (rel) => listEntries(abs(rel)),
});
for (const line of formatDepsOffline(report)) console.log(line);
process.exit(report.ok ? 0 : 1);
