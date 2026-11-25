/**
 * プレビューの断片が許可表を通らなかったときの、生成の止め方(点検 13 回目 C13-8)。
 *
 * 断片は製品のコミットされた入力で、実装が許可表の外の属性を描くと章のプレビューが黙って消える。章に「置かない」と書いて緑にせず、生成そのものを止める。
 * 許可表は `lib/kernel/preview-check.ts`、断片を置く口は `markup.ts` の `previewFragment`。製品が置いた断片は `verify` の S22 が先に見る。
 * ここは生成の中の止め方で(前提の失敗の名前は `book-preview`)、S22 が見ない断片(仕様から組む部品の見本)もここで止まる。止まったら `npm run generate` と `generate:check` が赤になる。
 */

import { preconditionFailure } from '../../../../kernel/generator-precondition.js';
import type { ProductRoots } from '../../../../model/product/types.js';
import { previewsPath, specPath } from '../../../../model/product/paths.js';
import { flatFragment, previewProblems } from '../../../../kernel/preview-check.js';

/**
 * 断片を置けないので生成を止める。
 *
 * @param fragment 許可表を通らなかった断片
 * @param what 何の断片か(画面の名前など。報告に出す)
 * @param roots 製品の根
 * @returns 返らない
 */
export function previewRefused(fragment: string, what: string, roots: ProductRoots): never {
  const reasons = previewProblems(flatFragment(fragment));
  return preconditionFailure('book-preview', [
    {
      message: `プレビューの断片 ${what} が許可表を通りません: ${reasons.join(' / ')}`,
      suggestion: '実装が描く HTML を許可表の中に直す(許可表は legacy/spec-tools/lib/kernel/preview-check.ts)。直したら cd app && npm run book:previews で断片を書き直す',
      counterexample: { fragment: what, reason: reasons[0] ?? '' },
      location: { file: previewsPath(roots) ?? specPath(roots, 'frontend/screens') },
    },
  ]);
}
