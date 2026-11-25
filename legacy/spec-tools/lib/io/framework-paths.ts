/**
 * **仕組み自身の保証台帳と、その見張りテストの置き場**(仕組み自身の住所)。
 *
 * 製品の根の宣言(`product.md`)からは来ない —— 保証台帳が 2 本になった(製品の `specs/backend/guarantees.md` と、
 * 仕組みが自分自身について持つ `framework/guarantees.md`)日から、仕組みの台帳は**製品が外せない義務**だからである
 * (`uses` や `roots` に仕組みの欄を作ると、製品はそれを選ばないことで義務を外せる)。住所は検査器の自分の位置から引く
 * (`extension-candidates.md` を読む `defaultLedgerFile` と同じ流儀)。
 *
 * ここに置くのは保証台帳の仕組みに属する住所だけ(台帳の住所・見張りテストの置き場・仕組みの根)で、`FRAMEWORK_*` の
 * 綴りの出どころは `paths.ts` のものを読む。
 */

import { fileURLToPath } from 'node:url';
import { FRAMEWORK_PACKAGES_DIR, FRAMEWORK_SPEC_TOOLS_DIR, runtimeSrcPath } from './paths.js';

/** 仕組みの保証台帳(仕組みの根からの相対)。 */
export const FRAMEWORK_GUARANTEES_FILE = `${FRAMEWORK_PACKAGES_DIR}/guarantees.md`;

/**
 * 仕組みの見張りテストを走査する置き場(仕組みの根からの相対)。
 *
 * 実行時パッケージ(`@kaninabe/runtime`)のソースは、守る対象のコードの隣にテストが住むので全体を見る。検証器・生成器の木では
 * 「意味の正(TS)と写し(SQL)が同じ判定を下す」差分テストを置く `__tests__/guarantees` だけを見る(木の全体を見ると、
 * 検証器のテストが fixture として書く `@tc` の文字列まで拾う)。W3 の綴りの正はここである。
 */
export const FRAMEWORK_TEST_ROOTS: readonly string[] = [
  runtimeSrcPath(),
  `${FRAMEWORK_SPEC_TOOLS_DIR}/__tests__/guarantees`,
];

/**
 * 仕組みの根 —— 実行している検査器のパッケージから 2 つ上(`legacy/spec-tools` の親の親)。
 *
 * 開発用の木でも配布の木でも「検査器は仕組みの木の中にある」ので成り立つ。パッケージを別に出す日に動くのはこの 1 関数だけ。
 *
 * @returns 仕組みの根の絶対パス(末尾に区切りを付けない)
 */
export function frameworkHostRoot(): string {
  const url = new URL('../../../../', import.meta.url);
  return fileURLToPath(url).replace(/[\\/]+$/, '');
}

/**
 * 仕組みの根の下のパスか(`FRAMEWORK_TEST_ROOTS` のどれかの下)。
 *
 * @param file 仕組みの根(またはリポジトリルート)からの相対パス(区切りは "/")
 * @returns 仕組みの見張りテストの置き場の下なら true
 */
export function isUnderFrameworkTestRoots(file: string): boolean {
  return FRAMEWORK_TEST_ROOTS.some((root) => file === root || file.startsWith(`${root}/`));
}
