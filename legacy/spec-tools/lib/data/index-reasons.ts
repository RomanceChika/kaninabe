/**
 * T2 の「余分な索引」の警告が出た**理由の区分**(`Finding.reason` に載せる閉じた語)と、その判定。
 *
 * T2 は「どの query_spec・関数の `lookup` も要求しない索引」を広く拾い、仕組みが所有する表の索引も製品が足した
 * 索引も同じ ID で出る。拡張候補の台帳(`lib/extension`)が仕組みの宿題として数えたいのは、**製品が `lookup` を
 * 書けない**警告だけである。仕組みの表(ジョブの台帳など)でも、**その表を持ち場とする関数を製品が `functions[]` で
 * 宣言している**なら、製品はその関数の `lookup` に索引の要求元を書ける —— 書かずに警告が出ているなら、それは製品が
 * 直せる側であり、仕組みの宿題に化けさせてはいけない(台帳の絞りが吸い込む)。
 *
 * 検査が理由を明示の欄で載せ、絞りの鍵(`extension/scope.ts`)がそれを読む(T16 の `check-reasons.ts` と同じ形)。
 * 純関数と定数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';

/** T2 の「余分な索引」の警告の理由(値は `Finding.reason` にそのまま入る)。 */
export const T2_REASONS = {
  /** 仕組みが所有する表で、その表を持ち場とする関数を製品が 1 つも宣言していない(`lookup` を書く場所が製品に無い)。 */
  frameworkTableFunctionless: 'framework_table_functionless',
  /** 上以外(製品の表の索引・関数を宣言している仕組みの表の索引)。製品が `lookup` を書く・索引を消すなどで直せる。 */
  unrequested: 'index_unrequested',
} as const;

/**
 * 余分な索引の警告の理由を決める。
 *
 * @param spec 索引を持つ表の宣言
 * @returns 理由の語
 */
export function unrequestedIndexReason(spec: DataTableSpec): string {
  return spec.framework !== undefined && spec.functions.length === 0
    ? T2_REASONS.frameworkTableFunctionless
    : T2_REASONS.unrequested;
}
