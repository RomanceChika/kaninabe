/**
 * 走査が歩かない置き場の閉じた表と、リポジトリルート相対の木の走査。**名前でなくパスで外す**(点検 14 回目 C14-1)。
 */

import { join } from 'node:path';
import { FRAMEWORK_PACKAGES_DIR, FRAMEWORK_SPEC_TOOLS_DIR, walkFiles } from './paths.js';

/**
 * 仕組みのパッケージの根(リポジトリルート相対)。**名前でなくパスで出力を外す**ための閉じた表で、ワークスペースの表との一致は `paths.test.ts` が見る。
 */
const FRAMEWORK_PACKAGE_DIRS: readonly string[] = [
  `${FRAMEWORK_PACKAGES_DIR}/adapters/log-axiom`,
  `${FRAMEWORK_PACKAGES_DIR}/adapters/postgrest`,
  `${FRAMEWORK_PACKAGES_DIR}/adapters/supabase-session`,
  `${FRAMEWORK_PACKAGES_DIR}/lint-config`,
  `${FRAMEWORK_PACKAGES_DIR}/runtime`,
  FRAMEWORK_SPEC_TOOLS_DIR,
];

/** パッケージの根の直下の出力と依存の置き場。 */
const PACKAGE_OUTPUTS: readonly string[] = ['node_modules', 'dist', 'coverage'];

/**
 * 走査が歩かない置き場の閉じた表(仕組みの木。リポジトリルートからのちょうどのパス)。
 *
 * **名前では飛ばさない**(点検 14 回目 C14-1)。`build` や `dist` は Next.js ではただの URL のセグメントで、集約の名前にもなる。名前で飛ばすと、その下の画面・操作・鍵の読み取り・仕様を全部の検査が見なくなった。
 */
export const FRAMEWORK_OUTPUT_PATHS: readonly string[] = FRAMEWORK_PACKAGE_DIRS.flatMap((dir) => PACKAGE_OUTPUTS.map((name) => `${dir}/${name}`));

/** 走査が歩かない置き場の閉じた表(実装の木の根からのちょうどのパス。`.gitignore` の根の行と同じ形)。 */
export const APP_OUTPUT_PATHS: readonly string[] = ['node_modules', '.next', '.next-e2e', '.next-shots', '.next-walk', 'coverage', 'out', 'build'];

/**
 * リポジトリルート相対の木の下で歩かない置き場を、その木の根からの相対で返す(`walkFiles` の第 3 引数)。
 *
 * @param dir 走査の根(リポジトリルート相対)
 * @param appRoot 実装の木の根(リポジトリルート相対。無ければ null)
 * @returns 走査の根からのちょうどのパス
 */
export function outputPathsUnder(dir: string, appRoot: string | null): readonly string[] {
  const rows = [...FRAMEWORK_OUTPUT_PATHS, ...(appRoot === null ? [] : APP_OUTPUT_PATHS.map((row) => `${appRoot}/${row}`))];
  return rows.filter((row) => row.startsWith(`${dir}/`)).map((row) => row.slice(dir.length + 1));
}

/**
 * 走査の相手のディレクトリがリポジトリルート相対で分かるときの `walkFiles`(出力の閉じた表を当てる)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param dir 走査の起点(リポジトリルート相対)
 * @param accept ファイル名の述語
 * @param appRoot 実装の木の根(リポジトリルート相対。走査の起点が実装の木の根のときに要る)
 * @returns 見つかったファイルの絶対パス
 */
export function walkRepoFiles(repoRoot: string, dir: string, accept: (name: string) => boolean, appRoot: string | null = null): string[] {
  return walkFiles(join(repoRoot, dir), accept, outputPathsUnder(dir, appRoot));
}
