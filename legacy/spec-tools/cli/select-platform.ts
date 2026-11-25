/**
 * SQL を書く CLI の入口が**後段の選択に加えて、プラットフォームの設定の契約を確かめる**共通の口。
 *
 * 後段を選ぶのは `select-targets.ts`(SQL の層を読まない)。選んだ後段が持つプラットフォームの設定は、契約
 * (`roles` の 3 つの値が互いに異なる)を満たすことを確かめてから配る。契約の違反は使い方の誤り(設定の値の選び間違い)なので、
 * 理由を出して終了コード 1 で終える(この CLI だけが `process.exit` を呼ぶ)。
 * **契約の範囲は「3 つのロール名の重なり」(`platformProfileProblems`)だけである**。空文字や、SQL の識別子として不正な値(空白・引用符・予約語など)は
 * 見ない(値の中身の妥当性はこの契約の外。足したくなった日に、`platformProfileProblems` へ判定を足す。その関数の JSDoc にも同じ範囲を書くのが本来だが、
 * 関数のあるファイルは約束事のモデルの写し元の閉包に入り、コメントだけの変更でも C24 の hash の更新を要するので、次に hash を更新する日に移す)。
 * SQL を書かない入口(`generate-book.ts`)は SQL の層を読まないので、この口を通さない(契約の検査は SQL の層にある)。
 */

import process from 'node:process';
import { platformProfileProblems } from '../lib/sql/platform-sql.js';
import type { Target, TargetSelection } from '../lib/target-api/contract.js';
import type { SelectionRoots } from '../lib/target-api/contract.js';
import { defaultTargetsFor, selectTargets } from './select-targets.js';

/**
 * 後段を選び、そのプラットフォームの設定が契約を満たすことを確かめて返す。違反があれば理由を標準エラーへ出して終了する。
 *
 * @param command どの CLI の名前か(メッセージの先頭に出す)
 * @param roots 製品が宣言した根(選択の契約が実装の木の有無と生成物の置き場を見る)
 * @param targets 選ぶ後段(既定はこのリポジトリが選ぶ後段を、製品に合わせたもの)
 * @returns 契約を満たす選択
 */
export function selectPlatformTargets(command: string, roots: SelectionRoots, targets: readonly Target[] = defaultTargetsFor(roots)): TargetSelection {
  const selection = selectTargets(command, roots, targets);
  const problems = platformProfileProblems(selection.platform);
  if (problems.length === 0) return selection;
  console.error(`${command}: プラットフォームの設定が契約を満たしていません:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
