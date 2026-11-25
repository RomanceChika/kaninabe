/**
 * 300 行を超える**宣言つきファイル**の本数を数える(verify の出力に出す情報。warning ではない)。
 *
 * 300 行は信号であって上限ではない。超えるファイルは冒頭の JSDoc に `@oversize`(1 つの責務の
 * まま超える理由)と `@split-review`(責務で割れるかの検討の結果)を持てば通るので、**宣言の本数に
 * 上限は置かない** —— 代わりに本数を毎回見せ、増え方が見えるようにする。
 *
 * 判定は `@kaninabe/lint-config` の `oversize.mjs` の純関数で、3 つの木の lint(自作規則
 * `layer/declared-oversize`)と**同じ関数**を呼ぶ(`io/oversize-rule.ts` が借りる口)。
 * 走査の母集合は lint と同じ木 —— 製品の実装の木と、仕組み側のパッケージ(検証器・生成器の
 * `legacy/spec-tools` を含む `framework` 1 本)—— で、テストと生成物は外す(lint も外している)。数えるのは**宣言が
 * 正しく揃った**ファイルだけ(違反は lint が error にする。ここは件数の報告に徹する)。
 *
 * 件数のほかに、同じ本文の `@split-review` が 3 本以上ある組(`repeated`)も返す。割る案と採らなかった
 * 理由はそのファイルで実際に考えたことでなければならず、どこにでも貼れる定型文の使い回しは検討の
 * 跡にならない。ファイル 1 本では見えない性質なので、全ファイルを数えるここで拾い、W4 が warning にする。
 */

import {
  FRAMEWORK_CODE_EXTENSIONS,
  FRAMEWORK_PACKAGES_DIR,
  FRAMEWORK_SPEC_TOOLS_DIR,
  toRelative,
} from '../io/paths.js';
import { walkRepoFiles } from '../io/output-paths.js';
import { loadOversizeRule, type RepeatedReview } from '../io/oversize-rule.js';
import { readText } from '../io/read-text.js';
import { sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { GENERATED_MARKER } from './scan.js';

/** 数えた結果。 */
export interface OversizeCount {
  /** 300 行を超え、宣言が正しく揃っているファイルの相対パス(昇順)。 */
  readonly declared: readonly string[];
  /** 同じ本文の `@split-review` が 3 本以上ある組(定型文の使い回し。W4 が warning にする)。 */
  readonly repeated: readonly RepeatedReview[];
}

/** テストの置き場かどうか(lint が 300 行の宣言の対象外にしているもの)。 */
function isTestPath(relativePath: string): boolean {
  return relativePath.includes('/__tests__/') || /\.test\.[cm]?[jt]sx?$/.test(relativePath);
}

/**
 * 300 行を超える宣言つきファイルを数える。
 *
 * @param repoRoot リポジトリルートの絶対パス(走査の起点)
 * @param roots 製品が宣言した根(実装の木の位置)
 * @param layout 置き場の配置(実装のソースの根 = 役割 `source-root`)
 * @returns 宣言つきファイルの一覧(実装の木や仕組みの木が無ければ、見える範囲だけ)
 */
export function countDeclaredOversize(repoRoot: string, roots: ProductRoots, layout: ProductLayout): OversizeCount {
  const rule = loadOversizeRule();
  const appSrc = sourceRootPath(layout, roots);
  // 仕組みの木は `framework` と `legacy/spec-tools` の 2 本(重ならないので二重に数えない)。
  const dirs = [FRAMEWORK_PACKAGES_DIR, FRAMEWORK_SPEC_TOOLS_DIR, ...(appSrc === null ? [] : [appSrc])];
  const declared: string[] = [];
  const reviews: { file: string; splitReview: string | null }[] = [];
  for (const dir of dirs) {
    for (const absolute of walkRepoFiles(repoRoot, dir, (name) => FRAMEWORK_CODE_EXTENSIONS.some((ext) => name.endsWith(ext)))) {
      const relativePath = toRelative(repoRoot, absolute);
      if (isTestPath(relativePath)) continue;
      const text = readText(absolute);
      // 生成物は先頭に目印のヘッダを持つ(文中に目印の語を書いただけのファイルは生成物ではない)。
      if (text.split('\n', 5).some((line) => line.includes(GENERATED_MARKER))) continue;
      const judgement = rule.judgeOversize(text);
      if (!judgement.declared) continue;
      declared.push(relativePath);
      reviews.push({ file: relativePath, splitReview: judgement.splitReview });
    }
  }
  return { declared: declared.sort(), repeated: rule.repeatedSplitReviews(reviews) };
}
