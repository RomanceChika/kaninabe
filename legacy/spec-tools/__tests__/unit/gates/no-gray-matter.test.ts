import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toRelative } from '../../../lib/io/paths.js';

/**
 * **フロントマターの読み取りは `lib/io/front-matter.ts` の 1 口だけ**にする見張り。
 *
 * 外部の gray-matter を既定の設定で呼ぶと、先頭が `---js` のファイルのフロントマターが JavaScript として
 * 評価される(仕様の束を読むだけでコードが動く)。口を自前の 1 本にしたので、`framework/` の
 * どのファイルも、その外部パッケージを import / require してはならず、`package.json` にも宣言しない。
 * 母集合は仕組みの木の全ての JS / TS のファイルとマニフェスト(テストを含む)で、導出は走査である。
 * (開発用リポジトリだけにある道具の木は配布物に入らないので、ここでは名指さない。)
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 外部パッケージの名前(綴りを 1 か所に集めるため、分けて書く)。 */
const PACKAGE = ['gray', 'matter'].join('-');

/** そのパッケージを読み込む形(import / export … from / require / 動的 import)。 */
const LOAD_PATTERN = new RegExp(`(?:from\\s*|require\\s*\\(\\s*|import\\s*\\(?\\s*)['"]${PACKAGE}(?:/[^'"]*)?['"]`);

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** 走査する木。 */
const ROOTS = ['framework'] as const;

/**
 * 木を歩いてファイルを集める。**`node_modules` だけを飛ばす**(`lib/io/paths.ts` の `walkFiles` が飛ばす
 * `dist` 名のディレクトリも歩く)。
 */
function walkFiles(root: string, accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(target, accept));
    else if (accept(entry.name)) found.push(target);
  }
  return found;
}

describe('gray-matter を使わない(フロントマターの読み取りは自前の 1 口)', () => {
  it('framework/ のどのファイルも、その外部パッケージを読み込まない', () => {
    const files = ROOTS.flatMap((root) => walkFiles(path.join(REPO_ROOT, root), (name) => SOURCE_FILE.test(name)));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => LOAD_PATTERN.test(readFileSync(file, 'utf8')))
      .map((file) => toRelative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('framework/ のどの package.json も、その外部パッケージを依存に宣言しない', () => {
    const manifests = ROOTS.flatMap((root) => walkFiles(path.join(REPO_ROOT, root), (name) => name === 'package.json'));
    expect(manifests.length).toBeGreaterThan(3);
    const offenders = manifests
      .filter((file) => {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((section) => {
          const table = manifest[section];
          return typeof table === 'object' && table !== null && PACKAGE in table;
        });
      })
      .map((file) => toRelative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
    // 1 本目と同じく仕組みの木の全体を歩く走査(読むのは package.json だけでも、歩く量は同じ)。上限も同じにする。
  });
});
