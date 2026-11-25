/**
 * 定型 RPC の先掴みが掴む 1 行を、**この書き込みが自表のどの参照列に入れる値で決まる行か**としてデータで名指す語(点検 fix26 3 回目 D26c-1・D26c-2)。
 *
 * 掴みの計画(`rpc-body-lock.ts` の `lockPlan`)の各行と、書く参照の列の値(`rpc-fk-check-order.ts`)が同じ語で書かれるので、「新しい親の行を、
 * 先掴みが同じ値で掴んでいるか」を SQL の字面ではなく、この語の一致で突き合わせられる。語が言えるのは「自表の参照列に**この書き込みが入れる値**
 * (作成の入れる値・編集の書いた後の値)が指す行」だけで、それ以外(書く前の値・実行者の行・対象の行・副問い合わせの行)は語を持たない ——
 * 照合では「同じ行と言えない」= 覆いにならない側として扱う(点検 fix26 4 回目の観点 3。該当の無い語は持たない)。
 *
 * 純関数・型だけを持つ。**アプリの語彙は 1 語も持たない。**
 */

/** 掴む 1 行の決まり方(自表の参照列 `column` にこの書き込みが入れる値が指す行)。 */
export interface RowId {
  readonly column: string;
}

/**
 * 自表の参照列にこの書き込みが入れる値が指す行。
 *
 * @param column 自表の参照列
 * @returns 行の決まり方
 */
export function writtenRow(column: string): RowId {
  return { column };
}

/**
 * 同じ行と言い切れるか(同じ列に入れる値なら同じ行)。
 *
 * @param left 行の決まり方
 * @param right 行の決まり方
 * @returns 同じ行なら true
 */
export function sameRow(left: RowId, right: RowId): boolean {
  return left.column === right.column;
}
