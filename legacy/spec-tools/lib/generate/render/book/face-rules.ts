/**
 * 章の上段の「アクセスの宣言」(必読に数える公理のうち、access_spec の `reads` / `creates` / `writes` / `deletes`)。
 *
 * **数える単位は表の行**で、宣言 1 本ずつではない(数え方の正は `semantics/reading-axioms.ts`):
 *
 * - **読む** … 集約ごとに **1 ブロック**(`bf-rule`。行頭に読み方の印)。中は**見えるロールだけ 1 行 1 主張**
 *   (「メンバー: 全件 ⚠ …」「世話役: 自分の行」)で、見えないロールは最後の 1 行に名前を並べて**明示**する(隠さない)。
 *   全件の行には ⚠ の意味を 1 句添える(全件の行が 2 本以上のブロックは、行ごとに繰り返さずブロックの先頭に 1 回だけ置く)。条件(`filters` / `when`)つきの行は、条件を下の折りたたみに残す。
 *   行頭の語はロール名(仕様の語)で、ラベル行の語 17 語の外にある(`bf-rk`)。列を持たないので、ロールが何人いても列は 2 つ(束 ⑧-d)
 * - **作る・書く・消す** … 種類・書ける欄・条件が同じ宣言の役を 1 行にまとめた行(`bf-rule`。行頭に読み方の印)。
 *   範囲の集約ごとに折りたたみにまとめ、畳んでも見出しと行数が見える
 *
 * 行の中は定型のラベル行(誰が / 決まること / 条件)だけで、値は仕様の欄と 1 対 1 である。
 * 従属する集約の宣言は親に写したまま出す(`when` が親の状態を条件にした編集可否の唯一の置き場だから)。
 * 計算される欄(`computes`)は必読に数えない導出なので、ここには出さない(下段 = `html/aggregate-lower.ts`)。
 */

import type { SpecModel } from '../../../model/types.js';
import { type AccessWriteRow } from '../../../semantics/reading-axioms.js';
import { type AccessGroup } from './face-facts.js';

/** 作る・書く・消すの種類の呼び名(行頭に出す)。 */
export const KIND_WORDS: Readonly<Record<AccessWriteRow['kind'], string>> = {
  create: '作る',
  write: '書く',
  delete: '消す',
};

/** 全件の行の ⚠ の意味(1 句。ここで「全件見せてよいか」を判断する)。 */
export const WIDE_READ_GLOSS = '絞る条件の無い全行。意図した全公開かを、ここで判断する';

/**
 * 1 ブロックの中で、⚠ の 1 句を行ごとに添える最大の本数(これを超えたらブロックの先頭に 1 回だけ出す)。
 * 全件が 2 ロール以上続くと同じ 1 句が行ごとに繰り返されて読みにくいので、1 本のときだけ行に添える。
 */
export const WIDE_GLOSS_PER_ROW_MAX = 1;

/** 読むのブロックに並べる役の範囲(ロールの宣言順。範囲のどこかで読みの宣言があるロール)。 */
export function readUniverse(model: SpecModel, groups: readonly AccessGroup[]): string[] {
  const used = new Set(groups.flatMap((group) => group.table.reads.map((rule) => rule.by)));
  return model.roles.roles.map((role) => role.id).filter((id) => used.has(id));
}

